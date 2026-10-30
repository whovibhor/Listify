"""Changing an existing member: roles, departments, suspension, removal, ownership (Phase 4).

Each change and its audit row commit together. Access checks read the database on every request,
so a change applies from the affected person's next request, with no session handling needed.
"""

from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.common import rate_limit
from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.modules.audit_logs import service as audit
from app.modules.auth import passwords
from app.modules.memberships.models import (
    DepartmentMembership,
    MembershipRequest,
    MembershipRole,
    MembershipStatus,
    OrganizationMembership,
    RequestStatus,
)
from app.modules.memberships.policies import ACTION_PERMISSIONS, allowed_actions, is_owner
from app.modules.memberships.schemas import (
    ImpactAction,
    MemberAction,
    MemberActionNote,
    MemberDepartment,
    MemberImpact,
    MemberRole,
    MemberRolesUpdate,
    MemberTransfer,
    OwnershipTransfer,
)
from app.modules.memberships.service import MembershipValidationError, _active_department
from app.modules.organizations.models import Department, Organization
from app.modules.organizations.service import get_department, role_by_key
from app.modules.permissions import catalog
from app.modules.permissions.models import Role
from app.modules.permissions.service import OrgContext

OWNERSHIP_ATTEMPTS_PER_USER = rate_limit.RateLimit("ownership:user", 10, timedelta(hours=1))


class OwnerProtectedError(ForbiddenError):
    code = "owner_protected"


class OwnMembershipError(ForbiddenError):
    code = "own_membership"


class MemberStateError(ConflictError):
    code = "member_state"


class AlreadyInDepartmentError(ConflictError):
    code = "already_in_department"


# --- Finding the member ----------------------------------------------------------------------


def _find_member(db: Session, context: OrgContext, membership_id: int) -> OrganizationMembership:
    target = db.scalar(
        select(OrganizationMembership).where(
            OrganizationMembership.id == membership_id,
            OrganizationMembership.organization_id == context.organization.id,
            OrganizationMembership.status != MembershipStatus.REMOVED,
        )
    )
    if target is None:
        raise NotFoundError("Member not found.")
    return target


def _check_allowed(
    context: OrgContext, target: OrganizationMembership, action: MemberAction
) -> None:
    if action in allowed_actions(context, target):
        return
    is_self = target.user_id == context.user.id
    if is_owner(target) and not is_self:
        raise OwnerProtectedError("Only the Owner can change the Owner's membership.")
    if is_self:
        raise OwnMembershipError("You can't make this change to your own membership.")
    raise MemberStateError("This isn't possible while their membership is in its current state.")


def _load_member(
    db: Session, context: OrgContext, membership_id: int, action: MemberAction
) -> OrganizationMembership:
    """The target of a change, with member changes in this organization serialized.

    Without the lock, suspending someone could race with making them Owner. Committing first
    ends the read snapshot taken while loading the context, so everything below is current.
    """
    context.require(ACTION_PERMISSIONS[action])
    db.commit()
    db.expire_all()
    db.scalar(
        select(Organization.id).where(Organization.id == context.organization.id).with_for_update()
    )
    target = _find_member(db, context, membership_id)
    _check_allowed(context, target, action)
    return target


def _department_ids(db: Session, target: OrganizationMembership) -> set[int]:
    return set(
        db.scalars(
            select(DepartmentMembership.department_id).where(
                DepartmentMembership.organization_id == target.organization_id,
                DepartmentMembership.user_id == target.user_id,
            )
        )
    )


def _record(
    db: Session,
    context: OrgContext,
    target: OrganizationMembership,
    action: str,
    **details: object,
) -> None:
    audit.record(
        db,
        organization_id=context.organization.id,
        actor_id=context.user.id,
        action=action,
        target_type="organization_membership",
        target_id=target.id,
        details={"user_id": target.user_id, "user_name": target.user.name, **details},
    )


def _role_labels(target: OrganizationMembership) -> list[str]:
    return sorted(assignment.role.key for assignment in target.roles)


# --- Roles -----------------------------------------------------------------------------------


def change_roles(
    db: Session, context: OrgContext, membership_id: int, payload: MemberRolesUpdate
) -> OrganizationMembership:
    target = _load_member(db, context, membership_id, "change_roles")
    wanted = {(payload.organization_role, None)} | {
        (choice.role_key, choice.department_id) for choice in payload.department_roles
    }
    current = {(assignment.role.key, assignment.department_id) for assignment in target.roles}
    if wanted == current:
        return target

    department_ids = _department_ids(db, target)
    for _, department_id in wanted - current:
        if department_id is None:
            continue
        if department_id not in department_ids:
            raise MembershipValidationError(
                "department_roles", "Add them to that department before giving them a role in it."
            )
        _active_department(db, context.organization.id, department_id)

    target.roles[:] = [
        assignment
        for assignment in target.roles
        if (assignment.role.key, assignment.department_id) in wanted
    ]
    for role_key, department_id in wanted - current:
        target.roles.append(
            MembershipRole(
                role_id=role_by_key(db, role_key).id,
                department_id=department_id,
                assigned_by=context.user.id,
            )
        )
    _record(
        db,
        context,
        target,
        "member.roles_changed",
        before=sorted(f"{key}:{department}" for key, department in current),
        after=sorted(f"{key}:{department}" for key, department in wanted),
    )
    db.commit()
    return target


# --- Suspension and removal ------------------------------------------------------------------


def suspend_member(
    db: Session, context: OrgContext, membership_id: int, payload: MemberActionNote
) -> OrganizationMembership:
    """Access stops, but roles and departments stay for reactivation."""
    target = _load_member(db, context, membership_id, "suspend")
    target.status = MembershipStatus.SUSPENDED
    _record(db, context, target, "member.suspended", reason=payload.reason or None)
    db.commit()
    return target


def reactivate_member(
    db: Session, context: OrgContext, membership_id: int
) -> OrganizationMembership:
    target = _load_member(db, context, membership_id, "reactivate")
    target.status = MembershipStatus.ACTIVE
    _record(db, context, target, "member.reactivated")
    db.commit()
    return target


def remove_member(
    db: Session, context: OrgContext, membership_id: int, payload: MemberActionNote
) -> None:
    """The row stays as history; everything that grants access goes (see `_grant_membership`)."""
    target = _load_member(db, context, membership_id, "remove")
    _record(
        db,
        context,
        target,
        "member.removed",
        reason=payload.reason or None,
        roles=_role_labels(target),
        department_ids=sorted(_department_ids(db, target)),
    )
    target.status = MembershipStatus.REMOVED
    target.primary_department_id = None
    target.roles.clear()
    db.execute(
        delete(DepartmentMembership).where(
            DepartmentMembership.organization_id == target.organization_id,
            DepartmentMembership.user_id == target.user_id,
        )
    )
    db.commit()


# --- Departments -----------------------------------------------------------------------------


def _leave(db: Session, target: OrganizationMembership, department_id: int) -> None:
    """Ends department access: the link and any role limited to that department."""
    db.execute(
        delete(DepartmentMembership).where(
            DepartmentMembership.department_id == department_id,
            DepartmentMembership.user_id == target.user_id,
        )
    )
    target.roles[:] = [
        assignment for assignment in target.roles if assignment.department_id != department_id
    ]
    if target.primary_department_id == department_id:
        target.primary_department_id = None


def _require_in_department(
    db: Session, target: OrganizationMembership, department_id: int, field: str
) -> Department:
    if department_id not in _department_ids(db, target):
        raise MembershipValidationError(field, "They aren't in that department.")
    return get_department(db, target.organization_id, department_id)


def _plan_transfer(
    db: Session, target: OrganizationMembership, from_department_id: int, to_department_id: int
) -> tuple[Department, Department]:
    source = _require_in_department(db, target, from_department_id, "from_department_id")
    if to_department_id == from_department_id:
        raise MembershipValidationError("to_department_id", "Choose a different department.")
    destination = _active_department(db, target.organization_id, to_department_id)
    if to_department_id in _department_ids(db, target):
        raise AlreadyInDepartmentError("They're already in that department.")
    return source, destination


def transfer_member(
    db: Session, context: OrgContext, membership_id: int, payload: MemberTransfer
) -> OrganizationMembership:
    """Moves someone between departments. The admin's confirmation is the approval (FR-ORG-08)."""
    target = _load_member(db, context, membership_id, "transfer")
    source, destination = _plan_transfer(
        db, target, payload.from_department_id, payload.to_department_id
    )
    roles_ended = [
        assignment.role.key for assignment in target.roles if assignment.department_id == source.id
    ]
    _leave(db, target, source.id)
    db.add(
        DepartmentMembership(
            organization_id=target.organization_id,
            department_id=destination.id,
            user_id=target.user_id,
        )
    )
    if target.primary_department_id is None:
        target.primary_department_id = destination.id
    _record(
        db,
        context,
        target,
        "member.transferred",
        from_department=source.name,
        to_department=destination.name,
        roles_ended=roles_ended,
    )
    db.commit()
    return target


def add_department(
    db: Session, context: OrgContext, membership_id: int, department_id: int
) -> OrganizationMembership:
    target = _load_member(db, context, membership_id, "add_department")
    department = _active_department(db, context.organization.id, department_id)
    if department_id in _department_ids(db, target):
        raise AlreadyInDepartmentError("They're already in that department.")
    db.add(
        DepartmentMembership(
            organization_id=target.organization_id,
            department_id=department_id,
            user_id=target.user_id,
        )
    )
    if target.primary_department_id is None:
        target.primary_department_id = department_id
    _record(db, context, target, "member.department_added", department=department.name)
    db.commit()
    return target


def leave_department(
    db: Session, context: OrgContext, membership_id: int, department_id: int
) -> OrganizationMembership:
    target = _load_member(db, context, membership_id, "leave_department")
    department = _require_in_department(db, target, department_id, "department_id")
    _leave(db, target, department_id)
    if target.primary_department_id is None:
        remaining = _department_ids(db, target)
        target.primary_department_id = min(remaining) if remaining else None
    _record(db, context, target, "member.department_removed", department=department.name)
    db.commit()
    return target


# --- Ownership -------------------------------------------------------------------------------


def transfer_ownership(db: Session, context: OrgContext, payload: OwnershipTransfer) -> None:
    """Swaps Owner and Admin in one transaction, so there's always exactly one Owner."""
    if not is_owner(context.membership):
        raise ForbiddenError("Only the Owner can transfer ownership.")
    rate_limit.hit(db, OWNERSHIP_ATTEMPTS_PER_USER, str(context.user.id))
    if not passwords.verify_password(context.user.password_hash, payload.password):
        raise MembershipValidationError("password", "That password isn't correct.")

    target = _load_member(db, context, payload.membership_id, "make_owner")
    current_owner = context.membership
    for membership, role_key in ((current_owner, catalog.ADMIN), (target, catalog.OWNER)):
        membership.roles[:] = [
            assignment for assignment in membership.roles if assignment.department_id is not None
        ]
        membership.roles.append(
            MembershipRole(role_id=role_by_key(db, role_key).id, assigned_by=context.user.id)
        )
    audit.record(
        db,
        organization_id=context.organization.id,
        actor_id=context.user.id,
        action="organization.ownership_transferred",
        target_type="organization_membership",
        target_id=target.id,
        details={
            "user_id": target.user_id,
            "user_name": target.user.name,
            "previous_owner_id": context.user.id,
            "previous_owner_name": context.user.name,
        },
    )
    db.commit()


# --- Impact preview --------------------------------------------------------------------------


def _sole_managers(db: Session, target: OrganizationMembership, department_ids: set[int]) -> set:
    """Departments in the set where nobody else active would be left as Department Manager."""
    held = {
        assignment.department_id
        for assignment in target.roles
        if assignment.role.key == catalog.DEPARTMENT_MANAGER
        and assignment.department_id in department_ids
    }
    if not held:
        return set()
    others = db.scalars(
        select(MembershipRole.department_id)
        .join(Role, Role.id == MembershipRole.role_id)
        .join(OrganizationMembership, OrganizationMembership.id == MembershipRole.membership_id)
        .where(
            Role.key == catalog.DEPARTMENT_MANAGER,
            MembershipRole.department_id.in_(held),
            OrganizationMembership.id != target.id,
            OrganizationMembership.status == MembershipStatus.ACTIVE,
        )
    )
    return held - set(others)


def member_impact(
    db: Session,
    context: OrgContext,
    membership_id: int,
    *,
    action: ImpactAction,
    from_department_id: int | None,
    to_department_id: int | None,
) -> MemberImpact:
    """What a change would do, checked exactly as the change itself is. Changes nothing."""
    context.require(ACTION_PERMISSIONS[action])
    target = _find_member(db, context, membership_id)
    _check_allowed(context, target, action)

    department_ids = _department_ids(db, target)
    gaining: list[Department] = []
    if action in ("transfer", "leave_department"):
        if from_department_id is None:
            raise MembershipValidationError("from_department_id", "Choose a department.")
        if action == "transfer":
            if to_department_id is None:
                raise MembershipValidationError("to_department_id", "Choose a department.")
            source, destination = _plan_transfer(db, target, from_department_id, to_department_id)
            gaining = [destination]
        else:
            source = _require_in_department(db, target, from_department_id, "from_department_id")
        losing_ids = {source.id}
    else:
        losing_ids = department_ids

    org_wide = {
        assignment.role.key for assignment in target.roles if assignment.department_id is None
    }
    keeps_every_department = action in ("transfer", "leave_department") and bool(
        org_wide & {catalog.OWNER, catalog.ADMIN}
    )
    ending = [
        assignment
        for assignment in target.roles
        if assignment.department_id in losing_ids
        or (assignment.department_id is None and action in ("suspend", "remove"))
    ]
    sole_manager_ids = _sole_managers(db, target, losing_ids)
    pending_requests = 0
    if sole_manager_ids:
        pending_requests = (
            db.scalar(
                select(func.count())
                .select_from(MembershipRequest)
                .where(
                    MembershipRequest.organization_id == context.organization.id,
                    MembershipRequest.requested_department_id.in_(sole_manager_ids),
                    MembershipRequest.status == RequestStatus.PENDING,
                )
            )
            or 0
        )

    names = {
        row.id: row.name
        for row in db.execute(
            select(Department.id, Department.name).where(
                Department.organization_id == context.organization.id
            )
        )
    }

    def departments(ids: set[int]) -> list[MemberDepartment]:
        return sorted(
            (
                MemberDepartment(id=department_id, name=names[department_id])
                for department_id in ids
            ),
            key=lambda department: department.name,
        )

    return MemberImpact(
        action=action,
        member_name=target.user.name,
        departments_losing=departments(losing_ids),
        departments_gaining=[MemberDepartment(id=d.id, name=d.name) for d in gaining],
        departments_keeping=departments(department_ids - losing_ids),
        roles_ending=[
            MemberRole(
                key=assignment.role.key,
                name=assignment.role.name,
                department_id=assignment.department_id,
            )
            for assignment in ending
        ],
        keeps_every_department=keeps_every_department,
        sole_manager_of=departments(sole_manager_ids),
        pending_requests=pending_requests,
    )
