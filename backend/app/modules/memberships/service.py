from collections.abc import Sequence
from datetime import timedelta
from urllib.parse import quote

from sqlalchemy import case, delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, contains_eager

from app.common import rate_limit
from app.common.mailer import EmailMessage, Mailer
from app.core.config import Settings
from app.core.exceptions import AppError, ConflictError, ForbiddenError, NotFoundError
from app.db.base import utc_now
from app.modules.audit_logs import service as audit
from app.modules.auth.tokens import hash_token, new_token
from app.modules.memberships.models import (
    DepartmentMembership,
    MembershipRequest,
    MembershipRole,
    MembershipStatus,
    OrganizationInvitation,
    OrganizationMembership,
    RequestStatus,
)
from app.modules.memberships.policies import allowed_actions
from app.modules.memberships.schemas import (
    InvitationCreate,
    InvitationPreview,
    InvitationRead,
    JoinRequestCreate,
    MemberDepartment,
    MemberRead,
    MemberRole,
    MembershipRequestRead,
    MyRequestRead,
    RequestApprove,
    RequestReject,
)
from app.modules.notifications.service import notify
from app.modules.organizations.models import (
    Department,
    DepartmentStatus,
    Organization,
    OrganizationStatus,
)
from app.modules.organizations.service import (
    get_department,
    get_joinable_organization,
    open_departments,
    role_by_key,
)
from app.modules.permissions import catalog
from app.modules.permissions.models import Role
from app.modules.permissions.service import OrgContext, load_context
from app.modules.users.models import User

JOIN_REQUESTS_PER_USER = rate_limit.RateLimit("join-request:user", 20, timedelta(hours=1))
INVITATIONS_PER_USER = rate_limit.RateLimit("invitation:user", 50, timedelta(hours=1))
MAX_ADMIN_INVITATION_DAYS = 7
DEPARTMENT_ROLES = (catalog.TEAM_LEAD, catalog.DEPARTMENT_MANAGER)


class MembershipValidationError(AppError):
    status_code = 422
    code = "validation_error"

    def __init__(self, field: str, message: str) -> None:
        super().__init__(message, details=[{"field": field, "message": message}])


class AlreadyMemberError(ConflictError):
    code = "already_member"


class RequestPendingError(ConflictError):
    code = "request_pending"


class MemberSuspendedError(ConflictError):
    code = "member_suspended"


class RequestNotPendingError(ConflictError):
    code = "request_not_pending"


class InvitationInvalidError(AppError):
    status_code = 400
    code = "invitation_invalid"


class InvitationEmailMismatchError(ForbiddenError):
    code = "invitation_email_mismatch"


# --- Granting access -------------------------------------------------------------------------


def _existing_membership(
    db: Session, organization_id: int, user_id: int
) -> OrganizationMembership | None:
    return db.scalar(
        select(OrganizationMembership).where(
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.user_id == user_id,
        )
    )


def _ensure_can_join(db: Session, organization_id: int, user_id: int) -> None:
    existing = _existing_membership(db, organization_id, user_id)
    if existing is None or existing.status == MembershipStatus.REMOVED:
        return
    if existing.status == MembershipStatus.ACTIVE:
        raise AlreadyMemberError("You're already a member of this organization.")
    raise MemberSuspendedError("Your membership is suspended. Contact an administrator.")


def _grant_membership(
    db: Session,
    *,
    organization_id: int,
    user_id: int,
    department_id: int | None,
    role: Role,
    job_title: str | None,
    actor_id: int | None,
) -> OrganizationMembership:
    """Creates or reactivates membership, department link and roles (caller's transaction)."""
    membership = _existing_membership(db, organization_id, user_id)
    now = utc_now()
    if membership is None:
        membership = OrganizationMembership(organization_id=organization_id, user_id=user_id)
        db.add(membership)
    else:
        # A previously removed member starts over: no old roles or departments survive.
        membership.roles.clear()
        db.execute(
            delete(DepartmentMembership).where(
                DepartmentMembership.organization_id == organization_id,
                DepartmentMembership.user_id == user_id,
            )
        )
    db.flush()
    membership.status = MembershipStatus.ACTIVE
    membership.joined_at = now
    membership.primary_department_id = department_id
    membership.job_title = job_title

    if department_id is not None:
        db.add(
            DepartmentMembership(
                organization_id=organization_id, department_id=department_id, user_id=user_id
            )
        )
    if role.key in DEPARTMENT_ROLES:
        # Department roles add to the base Member role and apply only to that department.
        membership.roles.append(
            MembershipRole(role_id=role_by_key(db, catalog.MEMBER).id, assigned_by=actor_id)
        )
        membership.roles.append(
            MembershipRole(role_id=role.id, department_id=department_id, assigned_by=actor_id)
        )
    else:
        membership.roles.append(MembershipRole(role_id=role.id, assigned_by=actor_id))
    return membership


def _active_department(db: Session, organization_id: int, department_id: int) -> Department:
    try:
        department = get_department(db, organization_id, department_id)
    except NotFoundError as exc:
        raise MembershipValidationError("department_id", "That department doesn't exist.") from exc
    if department.status != DepartmentStatus.ACTIVE:
        raise MembershipValidationError("department_id", "That department is archived.")
    return department


def _check_role_choice(role_key: str, department_id: int | None) -> None:
    if role_key in DEPARTMENT_ROLES and department_id is None:
        raise MembershipValidationError("department_id", "This role needs a department.")


# --- Join requests ---------------------------------------------------------------------------


def create_join_request(
    db: Session, user: User, organization_id: int, payload: JoinRequestCreate
) -> MembershipRequest:
    rate_limit.hit(db, JOIN_REQUESTS_PER_USER, str(user.id))
    organization = get_joinable_organization(db, organization_id)
    _ensure_can_join(db, organization.id, user.id)

    open_ids = {department.id for department in open_departments(db, organization.id)}
    if payload.department_id is None and open_ids:
        raise MembershipValidationError("department_id", "Choose a department.")
    if payload.department_id is not None and payload.department_id not in open_ids:
        raise MembershipValidationError(
            "department_id", "That department isn't accepting join requests."
        )

    request = MembershipRequest(
        organization_id=organization.id,
        user_id=user.id,
        requested_department_id=payload.department_id,
        job_title=payload.job_title or None,
        note=payload.note or None,
    )
    db.add(request)
    try:
        db.commit()
    except IntegrityError as exc:  # uq_membership_requests_one_pending
        db.rollback()
        raise RequestPendingError("You already have a pending request here.") from exc
    return request


def list_my_requests(db: Session, user: User) -> list[MyRequestRead]:
    rows = db.execute(
        select(MembershipRequest, Organization.name, Department.name)
        .join(Organization, Organization.id == MembershipRequest.organization_id)
        .outerjoin(Department, Department.id == MembershipRequest.requested_department_id)
        .where(MembershipRequest.user_id == user.id)
        .order_by(MembershipRequest.created_at.desc())
        .limit(100)
    ).all()
    return [
        MyRequestRead(
            id=request.id,
            organization_id=request.organization_id,
            organization_name=organization_name,
            requested_department_name=department_name,
            status=request.status,
            review_note=request.review_note,
            created_at=request.created_at,
        )
        for request, organization_name, department_name in rows
    ]


def cancel_my_request(db: Session, user: User, request_id: int) -> None:
    request = db.scalar(
        select(MembershipRequest)
        .where(MembershipRequest.id == request_id, MembershipRequest.user_id == user.id)
        .with_for_update()
    )
    if request is None:
        raise NotFoundError("Request not found.")
    if request.status != RequestStatus.PENDING:
        raise RequestNotPendingError("This request has already been decided.")
    request.status = RequestStatus.CANCELLED
    db.commit()


def _request_scope(context: OrgContext):
    """Org-wide approvers see everything; department managers see their own departments."""
    conditions = [MembershipRequest.organization_id == context.organization.id]
    if not context.can("member.approve"):
        conditions.append(
            MembershipRequest.requested_department_id.in_(
                list(context.departments_with("member.approve"))
            )
        )
    return conditions


def list_requests(
    db: Session, context: OrgContext, status: RequestStatus | None, *, offset: int, limit: int
) -> tuple[list[MembershipRequestRead], int]:
    context.require_anywhere("member.approve")
    conditions = _request_scope(context)
    if status is not None:
        conditions.append(MembershipRequest.status == status)
    total = db.scalar(select(func.count()).select_from(MembershipRequest).where(*conditions)) or 0
    pending_first = case((MembershipRequest.status == RequestStatus.PENDING, 0), else_=1)
    rows = db.execute(
        select(MembershipRequest, Department.name)
        .outerjoin(Department, Department.id == MembershipRequest.requested_department_id)
        .where(*conditions)
        .order_by(pending_first, MembershipRequest.created_at.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    return [to_request_read(request, name) for request, name in rows], total


def to_request_read(
    request: MembershipRequest, department_name: str | None
) -> MembershipRequestRead:
    return MembershipRequestRead(
        id=request.id,
        organization_id=request.organization_id,
        organization_name=request.organization.name,
        user_id=request.user_id,
        user_name=request.user.name,
        user_email=request.user.email,
        requested_department_id=request.requested_department_id,
        requested_department_name=department_name,
        job_title=request.job_title,
        note=request.note,
        status=request.status,
        review_note=request.review_note,
        reviewed_at=request.reviewed_at,
        created_at=request.created_at,
    )


def read_request(db: Session, request: MembershipRequest) -> MembershipRequestRead:
    department = (
        db.get(Department, request.requested_department_id)
        if request.requested_department_id is not None
        else None
    )
    return to_request_read(request, department.name if department else None)


def _load_pending_request(db: Session, context: OrgContext, request_id: int) -> MembershipRequest:
    request = db.scalar(
        select(MembershipRequest)
        .where(MembershipRequest.id == request_id, *_request_scope(context))
        .with_for_update()
    )
    if request is None:
        raise NotFoundError("Request not found.")
    if request.status != RequestStatus.PENDING:
        raise RequestNotPendingError("This request has already been decided.")
    return request


def approve_request(
    db: Session, context: OrgContext, request_id: int, payload: RequestApprove
) -> MembershipRequest:
    """One transaction: membership, department link, role, request status and audit row."""
    context.require_anywhere("member.approve")
    request = _load_pending_request(db, context, request_id)

    department_id = (
        payload.department_id
        if "department_id" in payload.model_fields_set
        else request.requested_department_id
    )
    if department_id is not None:
        _active_department(db, context.organization.id, department_id)
    # Approvers can only place people where they themselves have authority.
    context.require("member.approve", department_id)
    if payload.role_key != catalog.MEMBER:
        context.require("role.assign")
    _check_role_choice(payload.role_key, department_id)
    _ensure_can_join(db, context.organization.id, request.user_id)

    _grant_membership(
        db,
        organization_id=context.organization.id,
        user_id=request.user_id,
        department_id=department_id,
        role=role_by_key(db, payload.role_key),
        job_title=request.job_title,
        actor_id=context.user.id,
    )
    request.status = RequestStatus.APPROVED
    request.reviewed_by = context.user.id
    request.reviewed_at = utc_now()
    audit.record(
        db,
        organization_id=context.organization.id,
        actor_id=context.user.id,
        action="membership.approved",
        target_type="membership_request",
        target_id=request.id,
        details={
            "user_id": request.user_id,
            "user_name": request.user.name,
            "role": payload.role_key,
            "department_id": department_id,
            "requested_department_id": request.requested_department_id,
        },
    )
    db.commit()
    notify(
        db,
        [request.user_id],
        "membership_approved",
        actor_id=context.user.id,
        organization_id=context.organization.id,
        data={"organization_name": context.organization.name},
    )
    return request


def reject_request(
    db: Session, context: OrgContext, request_id: int, payload: RequestReject
) -> MembershipRequest:
    context.require_anywhere("member.approve")
    request = _load_pending_request(db, context, request_id)
    request.status = RequestStatus.REJECTED
    request.reviewed_by = context.user.id
    request.reviewed_at = utc_now()
    request.review_note = payload.note or None
    audit.record(
        db,
        organization_id=context.organization.id,
        actor_id=context.user.id,
        action="membership.rejected",
        target_type="membership_request",
        target_id=request.id,
        details={"user_id": request.user_id, "user_name": request.user.name},
    )
    db.commit()
    notify(
        db,
        [request.user_id],
        "membership_rejected",
        actor_id=context.user.id,
        organization_id=context.organization.id,
        data={"organization_name": context.organization.name},
    )
    return request


# --- Member directory ------------------------------------------------------------------------


def list_members(
    db: Session,
    context: OrgContext,
    *,
    q: str | None,
    department_id: int | None,
    status: MembershipStatus | None,
    offset: int,
    limit: int,
) -> tuple[list[MemberRead], int]:
    """Admins see everyone; other members see people in their own departments (ADR-011)."""
    context.require_anywhere("member.view")
    organization_id = context.organization.id
    conditions = [
        OrganizationMembership.organization_id == organization_id,
        OrganizationMembership.status != MembershipStatus.REMOVED,
    ]
    if status is not None:
        conditions.append(OrganizationMembership.status == status)
    sees_everyone = context.can("member.manage") or context.can("member.approve")
    if not sees_everyone:
        visible = select(DepartmentMembership.user_id).where(
            DepartmentMembership.organization_id == organization_id,
            DepartmentMembership.department_id.in_(list(context.department_ids)),
        )
        conditions.append(
            OrganizationMembership.user_id.in_(visible)
            | (OrganizationMembership.user_id == context.user.id)
        )
    if department_id is not None:
        conditions.append(
            OrganizationMembership.user_id.in_(
                select(DepartmentMembership.user_id).where(
                    DepartmentMembership.organization_id == organization_id,
                    DepartmentMembership.department_id == department_id,
                )
            )
        )
    statement = select(OrganizationMembership).join(User).where(*conditions)
    if q:
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        statement = statement.where(
            User.name.like(pattern, escape="\\") | User.email.like(pattern, escape="\\")
        )
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    memberships = db.scalars(
        statement.options(contains_eager(OrganizationMembership.user))
        .order_by(User.name)
        .offset(offset)
        .limit(limit)
    ).all()
    return to_member_reads(db, context, memberships), total


def to_member_reads(
    db: Session, context: OrgContext, memberships: Sequence[OrganizationMembership]
) -> list[MemberRead]:
    organization_id = context.organization.id
    user_ids = [membership.user_id for membership in memberships]
    departments: dict[int, list[MemberDepartment]] = {}
    if user_ids:
        for user_id, dept_id, dept_name in db.execute(
            select(DepartmentMembership.user_id, Department.id, Department.name)
            .join(Department, Department.id == DepartmentMembership.department_id)
            .where(
                DepartmentMembership.organization_id == organization_id,
                DepartmentMembership.user_id.in_(user_ids),
            )
            .order_by(Department.name)
        ):
            departments.setdefault(user_id, []).append(MemberDepartment(id=dept_id, name=dept_name))

    return [
        MemberRead(
            membership_id=membership.id,
            user_id=membership.user_id,
            name=membership.user.name,
            email=membership.user.email,
            job_title=membership.job_title,
            status=membership.status,
            joined_at=membership.joined_at,
            roles=[
                MemberRole(
                    key=assignment.role.key,
                    name=assignment.role.name,
                    department_id=assignment.department_id,
                )
                for assignment in membership.roles
            ],
            departments=departments.get(membership.user_id, []),
            actions=allowed_actions(context, membership),
        )
        for membership in memberships
    ]


# --- Invitations -----------------------------------------------------------------------------


def _invitation_status(invitation: OrganizationInvitation) -> str:
    if invitation.accepted_at is not None:
        return "accepted"
    if invitation.revoked_at is not None:
        return "revoked"
    if invitation.expires_at <= utc_now():
        return "expired"
    return "pending"


def revoke_invitations_from(db: Session, organization_id: int, user_id: int) -> int:
    """Ends someone's unused invitations when they lose the right to invite (S-01)."""
    result = db.execute(
        update(OrganizationInvitation)
        .where(
            OrganizationInvitation.organization_id == organization_id,
            OrganizationInvitation.created_by == user_id,
            OrganizationInvitation.accepted_at.is_(None),
            OrganizationInvitation.revoked_at.is_(None),
        )
        .values(revoked_at=utc_now())
    )
    return result.rowcount  # type: ignore[attr-defined, no-any-return]


def to_invitation_read(invitation: OrganizationInvitation) -> InvitationRead:
    return InvitationRead(
        id=invitation.id,
        email=invitation.email,
        role_name=invitation.role.name,
        department_name=invitation.department.name if invitation.department else None,
        expires_at=invitation.expires_at,
        status=_invitation_status(invitation),
        created_at=invitation.created_at,
    )


def create_invitation(
    db: Session,
    context: OrgContext,
    payload: InvitationCreate,
    settings: Settings,
    mailer: Mailer,
) -> tuple[OrganizationInvitation, str]:
    context.require("member.manage")
    if payload.role_key != catalog.MEMBER:
        context.require("role.assign")
    if payload.role_key == catalog.ADMIN:
        if payload.email is None:
            raise MembershipValidationError(
                "email", "Admin invitations must go to a specific email address."
            )
        if payload.expires_in_days > MAX_ADMIN_INVITATION_DAYS:
            raise MembershipValidationError(
                "expires_in_days",
                f"Admin invitations can last at most {MAX_ADMIN_INVITATION_DAYS} days.",
            )
    rate_limit.hit(db, INVITATIONS_PER_USER, str(context.user.id))
    _check_role_choice(payload.role_key, payload.department_id)
    if payload.department_id is not None:
        _active_department(db, context.organization.id, payload.department_id)

    token = new_token()
    invitation = OrganizationInvitation(
        organization_id=context.organization.id,
        email=payload.email,
        token_hash=hash_token(token),
        role_id=role_by_key(db, payload.role_key).id,
        department_id=payload.department_id,
        expires_at=utc_now() + timedelta(days=payload.expires_in_days),
        created_by=context.user.id,
    )
    db.add(invitation)
    db.flush()
    audit.record(
        db,
        organization_id=context.organization.id,
        actor_id=context.user.id,
        action="invitation.created",
        target_type="invitation",
        target_id=invitation.id,
        details={"email": payload.email, "role": payload.role_key},
    )
    db.commit()

    link = f"{settings.frontend_base_url.rstrip('/')}/invite/{quote(token)}"
    if payload.email:
        mailer.send(
            EmailMessage(
                to=payload.email,
                subject=f"You're invited to join {context.organization.name} on Listify",
                body=(
                    f"{context.user.name} invited you to join {context.organization.name}.\n\n"
                    f"Accept here (the link can be used once and expires in "
                    f"{payload.expires_in_days} days):\n\n{link}"
                ),
            )
        )
    return invitation, link


def list_invitations(db: Session, context: OrgContext) -> list[InvitationRead]:
    context.require("member.manage")
    invitations = db.scalars(
        select(OrganizationInvitation)
        .where(OrganizationInvitation.organization_id == context.organization.id)
        .order_by(OrganizationInvitation.created_at.desc())
        .limit(200)
    ).all()
    return [to_invitation_read(invitation) for invitation in invitations]


def revoke_invitation(db: Session, context: OrgContext, invitation_id: int) -> None:
    context.require("member.manage")
    invitation = db.scalar(
        select(OrganizationInvitation).where(
            OrganizationInvitation.id == invitation_id,
            OrganizationInvitation.organization_id == context.organization.id,
        )
    )
    if invitation is None:
        raise NotFoundError("Invitation not found.")
    if _invitation_status(invitation) != "pending":
        raise ConflictError("Only pending invitations can be revoked.")
    invitation.revoked_at = utc_now()
    audit.record(
        db,
        organization_id=context.organization.id,
        actor_id=context.user.id,
        action="invitation.revoked",
        target_type="invitation",
        target_id=invitation.id,
    )
    db.commit()


def _creator_can_still_grant(db: Session, invitation: OrganizationInvitation) -> bool:
    """An invitation is only as good as its creator's authority today, not when they made it."""
    creator = db.get(User, invitation.created_by) if invitation.created_by else None
    if creator is None:
        return False
    try:
        context = load_context(db, creator, invitation.organization_id)
    except NotFoundError:
        return False
    return context.can("member.manage") and (
        invitation.role.key == catalog.MEMBER or context.can("role.assign")
    )


def _usable_invitation(
    db: Session, token: str, *, for_update: bool = False
) -> OrganizationInvitation:
    statement = select(OrganizationInvitation).where(
        OrganizationInvitation.token_hash == hash_token(token)
    )
    if for_update:
        statement = statement.with_for_update()
    invitation = db.scalar(statement)
    if (
        invitation is None
        or _invitation_status(invitation) != "pending"
        or invitation.organization.status != OrganizationStatus.ACTIVE
        or (invitation.department and invitation.department.status != DepartmentStatus.ACTIVE)
        or not _creator_can_still_grant(db, invitation)
    ):
        raise InvitationInvalidError("This invitation is invalid, has expired or was already used.")
    return invitation


def _check_invitation_email(invitation: OrganizationInvitation, user: User) -> None:
    if invitation.email and invitation.email != user.email:
        raise InvitationEmailMismatchError(
            "This invitation was sent to a different email address. Sign in with that "
            "address to accept it."
        )


def preview_invitation(db: Session, user: User, token: str) -> InvitationPreview:
    invitation = _usable_invitation(db, token)
    _check_invitation_email(invitation, user)
    membership = _existing_membership(db, invitation.organization_id, user.id)
    return InvitationPreview(
        organization_id=invitation.organization_id,
        organization_name=invitation.organization.name,
        organization_description=invitation.organization.description,
        department_name=invitation.department.name if invitation.department else None,
        role_name=invitation.role.name,
        email=invitation.email,
        already_member=membership is not None and membership.status == MembershipStatus.ACTIVE,
    )


def accept_invitation(db: Session, user: User, token: str) -> int:
    """Single-use: the row lock makes two simultaneous accepts impossible."""
    invitation = _usable_invitation(db, token, for_update=True)
    _check_invitation_email(invitation, user)
    _ensure_can_join(db, invitation.organization_id, user.id)

    _grant_membership(
        db,
        organization_id=invitation.organization_id,
        user_id=user.id,
        department_id=invitation.department_id,
        role=invitation.role,
        job_title=None,
        actor_id=invitation.created_by,
    )
    invitation.accepted_at = utc_now()
    invitation.accepted_by = user.id
    # Joining by invitation settles any request still waiting for this organization.
    pending = db.scalar(
        select(MembershipRequest).where(
            MembershipRequest.organization_id == invitation.organization_id,
            MembershipRequest.user_id == user.id,
            MembershipRequest.status == RequestStatus.PENDING,
        )
    )
    if pending is not None:
        pending.status = RequestStatus.CANCELLED
    audit.record(
        db,
        organization_id=invitation.organization_id,
        actor_id=user.id,
        action="invitation.accepted",
        target_type="invitation",
        target_id=invitation.id,
        details={"user_name": user.name, "role": invitation.role.key},
    )
    db.commit()
    return invitation.organization_id
