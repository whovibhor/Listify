from datetime import date

from pydantic import Field

from app.common.schemas import ApiModel, InputModel, UtcDateTime
from app.modules.collaboration.models import UpdateRequestStatus
from app.modules.tasks.models import TaskStatus
from app.modules.tasks.schemas import MAX_TASK_DATE, MIN_TASK_DATE, PersonRef

MAX_COMMENT_LENGTH = 5000
MAX_UPDATE_TEXT_LENGTH = 1000
MAX_MENTIONS = 20


class CommentCreate(InputModel):
    body: str = Field(min_length=1, max_length=MAX_COMMENT_LENGTH)
    mention_user_ids: list[int] = Field(default_factory=list, max_length=MAX_MENTIONS)


class CommentUpdate(InputModel):
    body: str = Field(min_length=1, max_length=MAX_COMMENT_LENGTH)


class CommentRead(ApiModel):
    id: int
    task_id: int
    author: PersonRef
    # Null once deleted: the text is gone from every response.
    body: str | None
    deleted: bool
    edited: bool
    created_at: UtcDateTime
    can_edit: bool
    can_delete: bool


class AttachmentRead(ApiModel):
    id: int
    task_id: int
    filename: str
    content_type: str
    size_bytes: int
    uploaded_by: PersonRef
    created_at: UtcDateTime
    can_delete: bool


class UpdateRequestCreate(InputModel):
    recipient_id: int
    message: str = Field(min_length=1, max_length=MAX_UPDATE_TEXT_LENGTH)
    # Local to the organization's timezone; the end of that day.
    respond_by: date | None = Field(default=None, ge=MIN_TASK_DATE, le=MAX_TASK_DATE)


class UpdateRequestRespond(InputModel):
    response_note: str = Field(min_length=1, max_length=MAX_UPDATE_TEXT_LENGTH)
    status: TaskStatus | None = None


class UpdateRequestRead(ApiModel):
    id: int
    task_id: int
    requester: PersonRef
    recipient: PersonRef
    message: str
    respond_by: UtcDateTime | None
    status: UpdateRequestStatus
    response_note: str | None
    responded_at: UtcDateTime | None
    created_at: UtcDateTime
    can_respond: bool
    can_cancel: bool


class PendingUpdateRequest(UpdateRequestRead):
    """One of the current user's own requests to answer, shown in the Inbox."""

    task_title: str
    organization_id: int
    allowed_statuses: list[TaskStatus]
