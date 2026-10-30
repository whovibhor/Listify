import re
import secrets
from collections.abc import Iterable

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, NotFoundError
from app.db.base import utc_now
from app.modules.audit_logs import service as audit
from app.modules.memberships.models import (
    DepartmentMembership,
    MembershipRequest,
    MembershipRole,
    MembershipStatus,
    OrganizationMembership,
    RequestStatus,
)
from app.modules.organizations.models import (
    Department,
    DepartmentStatus,
    Organization,
    OrganizationStatus,
)
from app.modules.organizations.schemas import (
    DepartmentInput,
    DepartmentRead,
    DepartmentUpdate,
    MyOrganization,
    OrganizationCreate,
    OrganizationPublic,
    OrganizationRead,
    OrganizationUpdate,
)
from app.modules.permissions import catalog
from app.modules.permissions.models import Role
from app.modules.permissions.service import OrgContext, load_context
from app.modules.users.models import User


class DepartmentNameTakenError(ConflictError):
    code = "department_name_taken"


def role_by_key(db: Session, key: str) -> Role:
    return db.scalars(select(Role).where(Role.key == key)).one()


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug[:120] or "organization"


def _unique_slug(db: Session, name: str) -> str:
    base = _slugify(name)
    if db.scalar(select(Organization.id).where(Organization.slug == base)) is None:
        return base
    return f"{base}-{secrets.token_hex(3)}"


def create_organization(db: Session, user: User, payload: OrganizationCreate) -> Organization:
    """Organization, Owner membership and first departments commit together or not at all."""
    organization = Organization(
        name=payload.name,
        slug=_unique_slug(db, payload.name),
        description=payload.description or None,
        website=payload.website,
        location=payload.location or None,
        timezone=payload.timezone or user.timezone,
        is_discoverable=payload.is_discoverable,
        created_by=user.id,
    )
    db.add(organization)
    db.flush()
    membership = OrganizationMembership(
        organization_id=organization.id, user_id=user.id, status=MembershipStatus.ACTIVE
    )
    membership.roles.append(
        MembershipRole(role_id=role_by_key(db, catalog.OWNER).id, assigned_by=user.id)
    )
    db.add(membership)
    for department in payload.departments:
        db.add(
            Department(
                organization_id=organization.id,
                name=department.name,
                description=department.description or None,
                open_for_join_requests=department.open_for_join_requests,
            )
        )
    audit.record(
        db,
        organization_id=organization.id,
        actor_id=user.id,
        action="organization.created",
        target_type="organization",
        target_id=organization.id,
        details={"name": organization.name},
    )
    db.commit()
    return organization


def to_my_organization(context: OrgContext) -> MyOrganization:
    return MyOrganization(
        **OrganizationRead.model_validate(context.organization).model_dump(),
        role_keys=context.role_keys,
        permissions=sorted(context.org_permissions),
        department_permissions={
            department_id: sorted(granted)
            for department_id, granted in context.department_permissions.items()
        },
        department_ids=sorted(context.department_ids),
    )


def list_my_organizations(db: Session, user: User) -> list[MyOrganization]:
    """Only active memberships of active organizations: the workspace switcher (FR-AUTH-05)."""
    organization_ids = db.scalars(
        select(OrganizationMembership.organization_id)
        .join(Organization, Organization.id == OrganizationMembership.organization_id)
        .where(
            OrganizationMembership.user_id == user.id,
            OrganizationMembership.status == MembershipStatus.ACTIVE,
            Organization.status == OrganizationStatus.ACTIVE,
        )
        .order_by(Organization.name)
    ).all()
    return [to_my_organization(load_context(db, user, org_id)) for org_id in organization_ids]


def update_organization(
    db: Session, context: OrgContext, payload: OrganizationUpdate
) -> Organization:
    organization = context.organization
    changes = payload.model_dump(exclude_unset=True)
    for key in ("name", "is_discoverable", "review_required", "timezone"):
        if key in changes and changes[key] is None:
            del changes[key]
    before = {key: getattr(organization, key) for key in changes}
    for key, value in changes.items():
        setattr(organization, key, value or None if key in _OPTIONAL_TEXT else value)
    audit.record(
        db,
        organization_id=organization.id,
        actor_id=context.user.id,
        action="organization.updated",
        target_type="organization",
        target_id=organization.id,
        details={"before": before, "after": changes},
    )
    db.commit()
    return organization


_OPTIONAL_TEXT = ("description", "website", "location")


# --- Discovery -------------------------------------------------------------------------------


def _my_statuses(db: Session, user: User, organization_ids: Iterable[int]) -> dict[int, str]:
    ids = list(organization_ids)
    if not ids:
        return {}
    statuses = dict.fromkeys(ids, "none")
    for org_id in db.scalars(
        select(MembershipRequest.organization_id).where(
            MembershipRequest.user_id == user.id,
            MembershipRequest.status == RequestStatus.PENDING,
            MembershipRequest.organization_id.in_(ids),
        )
    ):
        statuses[org_id] = "pending"
    for org_id in db.scalars(
        select(OrganizationMembership.organization_id).where(
            OrganizationMembership.user_id == user.id,
            OrganizationMembership.status == MembershipStatus.ACTIVE,
            OrganizationMembership.organization_id.in_(ids),
        )
    ):
        statuses[org_id] = "member"
    return statuses


def _to_public(organization: Organization, status: str) -> OrganizationPublic:
    return OrganizationPublic(
        id=organization.id,
        name=organization.name,
        description=organization.description,
        location=organization.location,
        website=organization.website,
        my_status=status,
    )


def discover_organizations(
    db: Session, user: User, q: str, *, offset: int, limit: int
) -> tuple[list[OrganizationPublic], int]:
    """Search only owners' opt-in organizations (ADR-014); others are invisible here."""
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    conditions = [
        Organization.is_discoverable.is_(True),
        Organization.status == OrganizationStatus.ACTIVE,
        Organization.name.like(f"%{escaped}%", escape="\\"),
    ]
    total = db.scalar(select(func.count()).select_from(Organization).where(*conditions)) or 0
    organizations = db.scalars(
        select(Organization)
        .where(*conditions)
        .order_by(Organization.name)
        .offset(offset)
        .limit(limit)
    ).all()
    statuses = _my_statuses(db, user, (o.id for o in organizations))
    return [_to_public(o, statuses[o.id]) for o in organizations], total


def get_joinable_organization(db: Session, organization_id: int) -> Organization:
    organization = db.get(Organization, organization_id)
    if (
        organization is None
        or organization.status != OrganizationStatus.ACTIVE
        or not organization.is_discoverable
    ):
        raise NotFoundError("Organization not found.")
    return organization


def open_departments(db: Session, organization_id: int) -> list[Department]:
    return list(
        db.scalars(
            select(Department)
            .where(
                Department.organization_id == organization_id,
                Department.status == DepartmentStatus.ACTIVE,
                Department.open_for_join_requests.is_(True),
            )
            .order_by(Department.name)
        )
    )


def join_status(db: Session, user: User, organization_id: int) -> str:
    return _my_statuses(db, user, [organization_id])[organization_id]


# --- Departments -----------------------------------------------------------------------------


def _member_counts(db: Session, organization_id: int) -> dict[int, int]:
    rows = db.execute(
        select(DepartmentMembership.department_id, func.count())
        .join(
            OrganizationMembership,
            (OrganizationMembership.user_id == DepartmentMembership.user_id)
            & (OrganizationMembership.organization_id == DepartmentMembership.organization_id),
        )
        .where(
            DepartmentMembership.organization_id == organization_id,
            OrganizationMembership.status == MembershipStatus.ACTIVE,
        )
        .group_by(DepartmentMembership.department_id)
    ).all()
    return {department_id: count for department_id, count in rows}


def list_departments(
    db: Session, context: OrgContext, *, include_archived: bool
) -> list[DepartmentRead]:
    """Administrators see every department; others only their own (BR-006 boundaries)."""
    organization_id = context.organization.id
    statement = select(Department).where(Department.organization_id == organization_id)
    sees_all = context.can("department.create") or context.can("member.manage")
    if not sees_all:
        statement = statement.where(Department.id.in_(list(context.department_ids)))
    if not (include_archived and sees_all):
        statement = statement.where(Department.status == DepartmentStatus.ACTIVE)
    counts = _member_counts(db, organization_id)
    return [
        DepartmentRead.model_validate(department).model_copy(
            update={"member_count": counts.get(department.id, 0)}
        )
        for department in db.scalars(statement.order_by(Department.name))
    ]


def get_department(db: Session, organization_id: int, department_id: int) -> Department:
    """Scoped by organization: another organization's department ID is simply not found."""
    department = db.scalar(
        select(Department).where(
            Department.id == department_id, Department.organization_id == organization_id
        )
    )
    if department is None:
        raise NotFoundError("Department not found.")
    return department


def _commit_department(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise DepartmentNameTakenError("A department with that name already exists.") from exc


def create_department(db: Session, context: OrgContext, payload: DepartmentInput) -> Department:
    department = Department(
        organization_id=context.organization.id,
        name=payload.name,
        description=payload.description or None,
        open_for_join_requests=payload.open_for_join_requests,
    )
    db.add(department)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise DepartmentNameTakenError("A department with that name already exists.") from exc
    audit.record(
        db,
        organization_id=context.organization.id,
        actor_id=context.user.id,
        action="department.created",
        target_type="department",
        target_id=department.id,
        details={"name": department.name},
    )
    _commit_department(db)
    return department


def update_department(
    db: Session, context: OrgContext, department: Department, payload: DepartmentUpdate
) -> Department:
    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes and changes["name"] is None:
        del changes["name"]
    if "open_for_join_requests" in changes and changes["open_for_join_requests"] is None:
        del changes["open_for_join_requests"]
    for key, value in changes.items():
        setattr(department, key, value or None if key == "description" else value)
    audit.record(
        db,
        organization_id=context.organization.id,
        actor_id=context.user.id,
        action="department.updated",
        target_type="department",
        target_id=department.id,
        details=changes,
    )
    _commit_department(db)
    return department


def set_department_archived(
    db: Session, context: OrgContext, department: Department, archived: bool
) -> Department:
    """Archiving closes the department to new members and tasks; memberships and history stay."""
    department.status = DepartmentStatus.ARCHIVED if archived else DepartmentStatus.ACTIVE
    if archived:
        department.open_for_join_requests = False
    audit.record(
        db,
        organization_id=context.organization.id,
        actor_id=context.user.id,
        action="department.archived" if archived else "department.restored",
        target_type="department",
        target_id=department.id,
        details={"name": department.name, "at": utc_now().isoformat()},
    )
    db.commit()
    return department
