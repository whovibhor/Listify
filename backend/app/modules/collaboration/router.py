from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse

from app.common.storage import StorageBackend, get_storage
from app.modules.auth.dependencies import CurrentAuth, DbSession
from app.modules.collaboration import attachments, comments, update_requests
from app.modules.collaboration.schemas import (
    AttachmentRead,
    CommentCreate,
    CommentRead,
    CommentUpdate,
    PendingUpdateRequest,
    UpdateRequestCreate,
    UpdateRequestRead,
    UpdateRequestRespond,
)
from app.modules.tasks import policies

router = APIRouter(tags=["collaboration"])

Storage = Annotated[StorageBackend, Depends(get_storage)]


# --- Comments ----------------------------------------------------------------------------------


@router.get("/tasks/{task_id}/comments", response_model=list[CommentRead])
def list_comments(task_id: int, auth: CurrentAuth, db: DbSession) -> list[CommentRead]:
    access = policies.get_access(db, auth.user, task_id)
    return comments.list_comments(db, access, auth.user)


@router.post(
    "/tasks/{task_id}/comments", response_model=CommentRead, status_code=status.HTTP_201_CREATED
)
def add_comment(
    task_id: int, payload: CommentCreate, auth: CurrentAuth, db: DbSession
) -> CommentRead:
    access = policies.get_access(db, auth.user, task_id)
    return comments.add_comment(db, access, auth.user, payload)


@router.patch("/comments/{comment_id}", response_model=CommentRead)
def edit_comment(
    comment_id: int, payload: CommentUpdate, auth: CurrentAuth, db: DbSession
) -> CommentRead:
    return comments.edit_comment(db, auth.user, comment_id, payload)


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment(comment_id: int, auth: CurrentAuth, db: DbSession) -> None:
    comments.delete_comment(db, auth.user, comment_id)


# --- Attachments -------------------------------------------------------------------------------


@router.get("/tasks/{task_id}/attachments", response_model=list[AttachmentRead])
def list_attachments(task_id: int, auth: CurrentAuth, db: DbSession) -> list[AttachmentRead]:
    access = policies.get_access(db, auth.user, task_id)
    return attachments.list_attachments(db, access, auth.user)


@router.post(
    "/tasks/{task_id}/attachments",
    response_model=AttachmentRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_attachment(
    task_id: int,
    filename: Annotated[str, Query(min_length=1, max_length=500)],
    request: Request,
    auth: CurrentAuth,
    db: DbSession,
    storage: Storage,
) -> AttachmentRead:
    """The request body is the file itself. Its size is capped before this runs (S-09)."""
    # Signing the user in opened a connection. Give it back before waiting on the client, or
    # a few dozen slow uploads would hold every connection and stall the whole app (ADR-032).
    await run_in_threadpool(db.commit)
    content = await request.body()
    return await run_in_threadpool(
        attachments.add_attachment, db, auth.user, task_id, filename, content, storage
    )


@router.get("/attachments/{attachment_id}/download")
def download_attachment(
    attachment_id: int, auth: CurrentAuth, db: DbSession, storage: Storage
) -> StreamingResponse:
    stream, attachment = attachments.open_download(db, auth.user, attachment_id, storage)
    return StreamingResponse(
        stream,
        media_type=attachment.content_type,
        headers=attachments.download_headers(attachment),
    )


@router.delete("/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_attachment(
    attachment_id: int, auth: CurrentAuth, db: DbSession, storage: Storage
) -> None:
    attachments.delete_attachment(db, auth.user, attachment_id, storage)


# --- Update requests ---------------------------------------------------------------------------


@router.get("/tasks/{task_id}/update-requests", response_model=list[UpdateRequestRead])
def list_update_requests(task_id: int, auth: CurrentAuth, db: DbSession) -> list[UpdateRequestRead]:
    access = policies.get_access(db, auth.user, task_id)
    return update_requests.list_for_task(db, access, auth.user)


@router.post(
    "/tasks/{task_id}/update-requests",
    response_model=UpdateRequestRead,
    status_code=status.HTTP_201_CREATED,
)
def request_update(
    task_id: int, payload: UpdateRequestCreate, auth: CurrentAuth, db: DbSession
) -> UpdateRequestRead:
    access = policies.get_access(db, auth.user, task_id)
    return update_requests.create(db, access, auth.user, payload)


@router.post("/update-requests/{request_id}/respond", response_model=UpdateRequestRead)
def respond_to_update(
    request_id: int, payload: UpdateRequestRespond, auth: CurrentAuth, db: DbSession
) -> UpdateRequestRead:
    return update_requests.respond(db, auth.user, request_id, payload)


@router.post("/update-requests/{request_id}/cancel", response_model=UpdateRequestRead)
def cancel_update(request_id: int, auth: CurrentAuth, db: DbSession) -> UpdateRequestRead:
    return update_requests.cancel(db, auth.user, request_id)


@router.get("/me/update-requests", response_model=list[PendingUpdateRequest])
def my_update_requests(auth: CurrentAuth, db: DbSession) -> list[PendingUpdateRequest]:
    return update_requests.list_pending_for_me(db, auth.user)
