from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select

from app.common.mailer import Mailer, get_mailer
from app.common.pagination import Page, PageParams, page_params
from app.modules.audit_logs.models import AuditLog
from app.modules.auth.dependencies import AppSettings, CurrentAuth, DbSession
from app.modules.memberships import service
from app.modules.memberships.models import RequestStatus
from app.modules.memberships.schemas import (
    AuditLogRead,
    InvitationCreate,
    InvitationCreated,
    InvitationPreview,
    InvitationRead,
    JoinRequestCreate,
    MemberRead,
    MembershipRequestRead,
    MyRequestRead,
    RequestApprove,
    RequestReject,
)
from app.modules.permissions.service import OrgCtx
from app.modules.users.models import User

router = APIRouter(tags=["memberships"])


# --- The requester's side --------------------------------------------------------------------


@router.post(
    "/organizations/{organization_id}/membership-requests",
    response_model=MyRequestRead,
    status_code=status.HTTP_201_CREATED,
)
def request_to_join(
    organization_id: int, payload: JoinRequestCreate, auth: CurrentAuth, db: DbSession
) -> MyRequestRead:
    request = service.create_join_request(db, auth.user, organization_id, payload)
    return next(r for r in service.list_my_requests(db, auth.user) if r.id == request.id)


@router.get("/me/membership-requests", response_model=list[MyRequestRead])
def my_requests(auth: CurrentAuth, db: DbSession) -> list[MyRequestRead]:
    return service.list_my_requests(db, auth.user)


@router.post("/me/membership-requests/{request_id}/cancel", status_code=status.HTTP_204_NO_CONTENT)
def cancel_my_request(request_id: int, auth: CurrentAuth, db: DbSession) -> None:
    service.cancel_my_request(db, auth.user, request_id)


# --- The approver's side ---------------------------------------------------------------------


@router.get(
    "/organizations/{organization_id}/membership-requests",
    response_model=Page[MembershipRequestRead],
)
def list_requests(
    context: OrgCtx,
    db: DbSession,
    paging: PageParams = Depends(page_params),
    status_filter: Annotated[RequestStatus | None, Query(alias="status")] = None,
) -> Page[MembershipRequestRead]:
    items, total = service.list_requests(
        db, context, status_filter, offset=paging.offset, limit=paging.page_size
    )
    return Page[MembershipRequestRead](
        items=items, page=paging.page, page_size=paging.page_size, total=total
    )


@router.post(
    "/organizations/{organization_id}/membership-requests/{request_id}/approve",
    response_model=MembershipRequestRead,
)
def approve_request(
    request_id: int, payload: RequestApprove, context: OrgCtx, db: DbSession
) -> MembershipRequestRead:
    return service.read_request(db, service.approve_request(db, context, request_id, payload))


@router.post(
    "/organizations/{organization_id}/membership-requests/{request_id}/reject",
    response_model=MembershipRequestRead,
)
def reject_request(
    request_id: int, payload: RequestReject, context: OrgCtx, db: DbSession
) -> MembershipRequestRead:
    return service.read_request(db, service.reject_request(db, context, request_id, payload))


# --- Members ---------------------------------------------------------------------------------


@router.get("/organizations/{organization_id}/members", response_model=Page[MemberRead])
def list_members(
    context: OrgCtx,
    db: DbSession,
    paging: PageParams = Depends(page_params),
    q: Annotated[str | None, Query(max_length=100)] = None,
    department_id: int | None = None,
) -> Page[MemberRead]:
    items, total = service.list_members(
        db,
        context,
        q=q.strip() if q else None,
        department_id=department_id,
        offset=paging.offset,
        limit=paging.page_size,
    )
    return Page[MemberRead](items=items, page=paging.page, page_size=paging.page_size, total=total)


# --- Invitations -----------------------------------------------------------------------------


@router.post(
    "/organizations/{organization_id}/invitations",
    response_model=InvitationCreated,
    status_code=status.HTTP_201_CREATED,
)
def create_invitation(
    payload: InvitationCreate,
    context: OrgCtx,
    db: DbSession,
    settings: AppSettings,
    mailer: Mailer = Depends(get_mailer),
) -> InvitationCreated:
    invitation, link = service.create_invitation(db, context, payload, settings, mailer)
    return InvitationCreated(**service.to_invitation_read(invitation).model_dump(), link=link)


@router.get("/organizations/{organization_id}/invitations", response_model=list[InvitationRead])
def list_invitations(context: OrgCtx, db: DbSession) -> list[InvitationRead]:
    return service.list_invitations(db, context)


@router.delete(
    "/organizations/{organization_id}/invitations/{invitation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def revoke_invitation(invitation_id: int, context: OrgCtx, db: DbSession) -> None:
    service.revoke_invitation(db, context, invitation_id)


@router.get("/invitations/{token}", response_model=InvitationPreview)
def preview_invitation(token: str, auth: CurrentAuth, db: DbSession) -> InvitationPreview:
    return service.preview_invitation(db, auth.user, token)


@router.post("/invitations/{token}/accept")
def accept_invitation(token: str, auth: CurrentAuth, db: DbSession) -> dict[str, int]:
    return {"organization_id": service.accept_invitation(db, auth.user, token)}


# --- Audit log -------------------------------------------------------------------------------


@router.get("/organizations/{organization_id}/audit-logs", response_model=Page[AuditLogRead])
def audit_logs(
    context: OrgCtx, db: DbSession, paging: PageParams = Depends(page_params)
) -> Page[AuditLogRead]:
    context.require("organization.settings.update")
    condition = AuditLog.organization_id == context.organization.id
    total = db.scalar(select(func.count()).select_from(AuditLog).where(condition)) or 0
    rows = db.execute(
        select(AuditLog, User.name)
        .outerjoin(User, User.id == AuditLog.actor_id)
        .where(condition)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .offset(paging.offset)
        .limit(paging.page_size)
    ).all()
    return Page[AuditLogRead](
        items=[
            AuditLogRead(
                id=entry.id,
                action=entry.action,
                actor_name=actor_name,
                target_type=entry.target_type,
                target_id=entry.target_id,
                details=entry.details,
                created_at=entry.created_at,
            )
            for entry, actor_name in rows
        ],
        page=paging.page,
        page_size=paging.page_size,
        total=total,
    )
