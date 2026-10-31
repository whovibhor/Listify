from datetime import date, time
from typing import Any

from pydantic import Field, model_validator

from app.common.schemas import ApiModel, InputModel, UtcDateTime
from app.modules.tasks.models import TagColor, TaskPriority, TaskStatus, TaskVisibility

MAX_TAGS_PER_TASK = 10
MAX_DESCRIPTION_LENGTH = 10_000
MAX_MINUTES = 100_000
MAX_PEOPLE_PER_TASK = 50
# Wide enough for any real plan, and safely inside what timezone conversion can handle.
MIN_TASK_DATE = date(1900, 1, 1)
MAX_TASK_DATE = date(2200, 12, 31)

# --- Tags -------------------------------------------------------------------------------------


class TagRead(ApiModel):
    id: int
    name: str
    color: TagColor


class TagCreate(InputModel):
    name: str = Field(min_length=1, max_length=40)
    color: TagColor = TagColor.GRAY


class TagUpdate(InputModel):
    name: str | None = Field(default=None, min_length=1, max_length=40)
    color: TagColor | None = None


# --- Tasks ------------------------------------------------------------------------------------


class _TaskFields(InputModel):
    """Dates are local to the user's profile timezone; the server converts them to UTC."""

    description: str | None = Field(default=None, max_length=MAX_DESCRIPTION_LENGTH)
    start_date: date | None = Field(default=None, ge=MIN_TASK_DATE, le=MAX_TASK_DATE)
    due_date: date | None = Field(default=None, ge=MIN_TASK_DATE, le=MAX_TASK_DATE)
    # Omitted/null with a due_date → all-day deadline (end of that local day).
    due_time: time | None = None
    tag_ids: list[int] | None = Field(default=None, max_length=MAX_TAGS_PER_TASK)
    estimated_minutes: int | None = Field(default=None, ge=0, le=MAX_MINUTES)

    @model_validator(mode="after")
    def check_dates(self) -> "_TaskFields":
        if self.due_time is not None and self.due_date is None:
            raise ValueError("due_time requires due_date")
        if self.start_date and self.due_date and self.start_date > self.due_date:
            raise ValueError("start_date must be on or before due_date")
        if self.tag_ids is not None and len(set(self.tag_ids)) != len(self.tag_ids):
            raise ValueError("tag_ids must not contain duplicates")
        return self


class TaskCreate(_TaskFields):
    title: str = Field(min_length=1, max_length=200)
    priority: TaskPriority = TaskPriority.MEDIUM
    status: TaskStatus = TaskStatus.NOT_STARTED
    parent_task_id: int | None = None

    @model_validator(mode="after")
    def check_initial_status(self) -> "TaskCreate":
        if self.status in {TaskStatus.COMPLETED, TaskStatus.CANCELLED, TaskStatus.IN_REVIEW}:
            raise ValueError("A new task must start as not_started, in_progress or blocked")
        return self


class OrganizationTaskCreate(TaskCreate):
    """Dates are local to the organization's timezone. Omit `visibility` for the default:
    Department in a department, otherwise Private."""

    department_id: int | None = None
    assigned_to: int | None = None
    collaborator_ids: list[int] = Field(default_factory=list, max_length=MAX_PEOPLE_PER_TASK)
    visibility: TaskVisibility | None = None
    visible_to: list[int] = Field(default_factory=list, max_length=MAX_PEOPLE_PER_TASK)


class TaskUpdate(_TaskFields):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    priority: TaskPriority | None = None
    status: TaskStatus | None = None
    actual_minutes: int | None = Field(default=None, ge=0, le=MAX_MINUTES)
    # Organization tasks only.
    assigned_to: int | None = None
    department_id: int | None = None
    visibility: TaskVisibility | None = None
    visible_to: list[int] | None = Field(default=None, max_length=MAX_PEOPLE_PER_TASK)

    @model_validator(mode="after")
    def check_non_nullable(self) -> "TaskUpdate":
        for field in ("title", "priority", "status", "visibility"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        if "due_time" in self.model_fields_set and "due_date" not in self.model_fields_set:
            raise ValueError("Send due_date together with due_time")
        return self


class PersonRef(ApiModel):
    id: int
    name: str


class DepartmentRef(ApiModel):
    id: int
    name: str


class CollaboratorAdd(InputModel):
    user_id: int


class TaskRead(ApiModel):
    id: int
    parent_task_id: int | None
    title: str
    description: str | None
    status: TaskStatus
    priority: TaskPriority
    start_at: UtcDateTime | None
    due_at: UtcDateTime | None
    due_all_day: bool
    is_overdue: bool
    completed_at: UtcDateTime | None
    archived_at: UtcDateTime | None
    created_at: UtcDateTime
    updated_at: UtcDateTime
    estimated_minutes: int | None
    actual_minutes: int | None
    tags: list[TagRead]
    subtask_count: int
    subtasks_completed: int
    # Organization tasks only; empty or null on personal tasks.
    organization_id: int | None = None
    visibility: TaskVisibility = TaskVisibility.PRIVATE
    department: DepartmentRef | None = None
    assignee: PersonRef | None = None
    creator: PersonRef | None = None
    collaborators: list[PersonRef] = Field(default_factory=list)
    needs_reassignment: bool = False
    # What the current user may do; the server still checks each action.
    allowed_statuses: list[TaskStatus] = Field(default_factory=list)
    actions: list[str] = Field(default_factory=list)


class TaskDetail(TaskRead):
    subtasks: list[TaskRead]
    visible_to: list[PersonRef] = Field(default_factory=list)


class BoardColumn(ApiModel):
    status: TaskStatus
    total: int
    # Completed tasks too old for the board, which the List view still has.
    older: int = 0
    items: list[TaskRead]


class BoardRead(ApiModel):
    department: DepartmentRef
    archived: bool
    review_required: bool
    can_create: bool
    columns: list[BoardColumn]


class ActivityRead(ApiModel):
    id: int
    event_type: str
    actor_id: int | None
    actor_name: str | None
    old_value: dict[str, Any] | None
    new_value: dict[str, Any] | None
    created_at: UtcDateTime
