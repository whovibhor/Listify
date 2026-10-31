from fastapi import APIRouter, Depends, status

from app.common.pagination import Page, PageParams, page_params
from app.modules.auth.dependencies import CurrentAuth, DbSession
from app.modules.notifications import inbox
from app.modules.notifications.schemas import (
    InboxFilter,
    InboxSummary,
    NotificationRead,
    Workspace,
)

router = APIRouter(tags=["notifications"])


@router.get("/inbox", response_model=Page[NotificationRead])
def read_inbox(
    auth: CurrentAuth,
    db: DbSession,
    paging: PageParams = Depends(page_params),
    filter: InboxFilter = "all",
    workspace: Workspace = None,
) -> Page[NotificationRead]:
    items, total = inbox.list_inbox(
        db, auth.user, filter, workspace=workspace, offset=paging.offset, limit=paging.page_size
    )
    return Page[NotificationRead](
        items=items, page=paging.page, page_size=paging.page_size, total=total
    )


@router.get("/inbox/summary", response_model=InboxSummary)
def inbox_summary(auth: CurrentAuth, db: DbSession, workspace: Workspace = None) -> InboxSummary:
    return inbox.summary(db, auth.user, workspace)


@router.post("/notifications/read-all", status_code=status.HTTP_204_NO_CONTENT)
def read_all(auth: CurrentAuth, db: DbSession, workspace: Workspace = None) -> None:
    inbox.mark_all_read(db, auth.user, workspace)


@router.post("/notifications/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def read_one(notification_id: int, auth: CurrentAuth, db: DbSession) -> None:
    inbox.mark_read(db, auth.user, notification_id)
