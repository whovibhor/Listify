from typing import Any, Literal

from app.common.schemas import ApiModel, UtcDateTime

InboxFilter = Literal["all", "unread", "assignments", "update_requests"]
# An organization's ID, "personal", or nothing for every workspace together.
Workspace = int | Literal["personal"] | None


class NotificationTask(ApiModel):
    id: int
    title: str
    organization_id: int


class NotificationRead(ApiModel):
    id: int
    type: str
    read: bool
    created_at: UtcDateTime
    # False for a task the person can no longer see: `task` and `actor_name` are then empty.
    accessible: bool
    actor_name: str | None
    organization_id: int | None
    task: NotificationTask | None
    data: dict[str, Any]


class InboxSummary(ApiModel):
    unread: int
    pending_update_requests: int
    # What's waiting in the person's other workspaces, for the dot on the workspace button.
    other_workspaces: int = 0
