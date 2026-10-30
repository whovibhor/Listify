from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy import ColumnElement, case, exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import UnaryExpression

from app.common.time import (
    END_OF_DAY,
    day_bounds_utc,
    day_start_utc,
    local_to_utc,
    local_today,
    zone,
)
from app.core.exceptions import AppError, ConflictError
from app.modules.tasks import policies
from app.modules.tasks.models import (
    OPEN_STATUSES,
    Tag,
    Task,
    TaskActivity,
    TaskPriority,
    TaskStatus,
    WorkspaceType,
    task_tags,
)
from app.modules.tasks.schemas import (
    ActivityRead,
    TagCreate,
    TagUpdate,
    TaskCreate,
    TaskDetail,
    TaskRead,
    TaskUpdate,
)
from app.modules.tasks.transitions import REOPEN_STATUS, allowed_targets
from app.modules.users.models import User

MAX_SUBTASKS = 50
UPCOMING_DAYS = 14


class TaskValidationError(AppError):
    status_code = 422
    code = "validation_error"

    def __init__(self, field_name: str, message: str) -> None:
        super().__init__(message, details=[{"field": field_name, "message": message}])


class InvalidTransitionError(ConflictError):
    code = "invalid_transition"


class OpenSubtasksError(ConflictError):
    code = "open_subtasks"


class TaskArchivedError(ConflictError):
    code = "task_archived"


class TagNameTakenError(ConflictError):
    code = "tag_name_taken"


# --- Serialization ---------------------------------------------------------------------------


def is_overdue(task: Task, now: datetime) -> bool:
    """BRD Rule 11: open (non-terminal) and due before now. No deadline → never overdue."""
    return task.is_open and task.due_at is not None and task.due_at < now


def to_read(task: Task, now: datetime) -> TaskRead:
    subtasks = task.subtasks if task.parent_task_id is None else []
    return TaskRead.model_validate(
        {
            **{name: getattr(task, name) for name in _READ_COLUMNS},
            "is_overdue": is_overdue(task, now),
            "tags": task.tags,
            "subtask_count": len(subtasks),
            "subtasks_completed": sum(1 for s in subtasks if s.status == TaskStatus.COMPLETED),
        }
    )


_READ_COLUMNS = (
    "id",
    "parent_task_id",
    "title",
    "description",
    "status",
    "priority",
    "start_at",
    "due_at",
    "due_all_day",
    "completed_at",
    "archived_at",
    "created_at",
    "updated_at",
    "estimated_minutes",
    "actual_minutes",
)


def to_detail(task: Task, now: datetime) -> TaskDetail:
    return TaskDetail.model_validate(
        {**to_read(task, now).model_dump(), "subtasks": [to_read(s, now) for s in task.subtasks]}
    )


# --- Activity --------------------------------------------------------------------------------


def _record(
    db: Session,
    task: Task,
    actor: User,
    event_type: str,
    old: dict[str, Any] | None = None,
    new: dict[str, Any] | None = None,
) -> None:
    db.add(
        TaskActivity(
            task_id=task.id,
            actor_id=actor.id,
            event_type=event_type,
            old_value=old,
            new_value=new,
        )
    )


def list_activity(db: Session, task: Task) -> list[ActivityRead]:
    rows = db.execute(
        select(TaskActivity, User.name)
        .outerjoin(User, User.id == TaskActivity.actor_id)
        .where(TaskActivity.task_id == task.id)
        .order_by(TaskActivity.created_at.desc(), TaskActivity.id.desc())
        .limit(200)
    ).all()
    return [
        ActivityRead.model_validate(
            {
                "id": activity.id,
                "event_type": activity.event_type,
                "actor_id": activity.actor_id,
                "actor_name": actor_name,
                "old_value": activity.old_value,
                "new_value": activity.new_value,
                "created_at": activity.created_at,
            }
        )
        for activity, actor_name in rows
    ]


def _jsonable(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat() + "Z"
    if hasattr(value, "value"):  # enums
        return value.value
    return value


# --- Dates -----------------------------------------------------------------------------------


def _due_from_local(user: User, due_date: date | None, due_time: time | None):
    if due_date is None:
        return None, True
    tz = zone(user.timezone)
    if due_time is None:
        return local_to_utc(due_date, END_OF_DAY, tz), True
    return local_to_utc(due_date, due_time, tz), False


def _start_from_local(user: User, start_date: date | None) -> datetime | None:
    return None if start_date is None else day_start_utc(start_date, zone(user.timezone))


# --- Create / update -------------------------------------------------------------------------


def _resolve_tags(db: Session, user: User, tag_ids: list[int]) -> list[Tag]:
    tags = policies.tags_owned_by(db, user, tag_ids)
    if len(tags) != len(tag_ids):
        raise TaskValidationError("tag_ids", "One or more tags don't exist.")
    return tags


def create_personal_task(db: Session, user: User, payload: TaskCreate) -> Task:
    parent: Task | None = None
    sort_order = 0
    if payload.parent_task_id is not None:
        parent = policies.get_task_for_user(db, user, payload.parent_task_id, for_update=True)
        if parent.parent_task_id is not None:
            raise TaskValidationError("parent_task_id", "Subtasks can't have their own subtasks.")
        if parent.archived_at is not None:
            raise TaskArchivedError("Restore the task before adding subtasks.")
        if len(parent.subtasks) >= MAX_SUBTASKS:
            raise TaskValidationError(
                "parent_task_id", f"A task can have at most {MAX_SUBTASKS} subtasks."
            )
        sort_order = max((s.sort_order for s in parent.subtasks), default=-1) + 1

    due_at, due_all_day = _due_from_local(user, payload.due_date, payload.due_time)
    task = Task(
        workspace_type=WorkspaceType.PERSONAL,
        owner_user_id=user.id,
        created_by=user.id,
        parent_task_id=parent.id if parent else None,
        title=payload.title,
        description=payload.description or None,
        status=payload.status,
        priority=payload.priority,
        start_at=_start_from_local(user, payload.start_date),
        due_at=due_at,
        due_all_day=due_all_day,
        estimated_minutes=payload.estimated_minutes,
        sort_order=sort_order,
        tags=_resolve_tags(db, user, payload.tag_ids or []),
    )
    db.add(task)
    db.flush()
    _record(db, task, user, "created", new={"title": task.title})
    if parent is not None:
        _record(db, parent, user, "subtask_added", new={"title": task.title, "subtask_id": task.id})
    db.commit()
    db.refresh(task)
    return task


def update_task(db: Session, user: User, task: Task, payload: TaskUpdate, now: datetime) -> Task:
    if task.archived_at is not None:
        raise TaskArchivedError("Archived tasks are read-only. Restore the task to edit it.")
    fields = payload.model_fields_set
    old: dict[str, Any] = {}
    new: dict[str, Any] = {}

    def assign(name: str, value: Any) -> None:
        current = getattr(task, name)
        if current != value:
            old[name], new[name] = _jsonable(current), _jsonable(value)
            setattr(task, name, value)

    for name in ("title", "priority", "estimated_minutes", "actual_minutes"):
        if name in fields:
            assign(name, getattr(payload, name))
    if "description" in fields:
        assign("description", payload.description or None)
    if "due_date" in fields:
        due_at, due_all_day = _due_from_local(user, payload.due_date, payload.due_time)
        assign("due_at", due_at)
        assign("due_all_day", due_all_day)
    if "start_date" in fields:
        assign("start_at", _start_from_local(user, payload.start_date))
    if task.start_at and task.due_at and task.start_at > task.due_at:
        raise TaskValidationError("start_date", "Start date must be on or before the deadline.")
    if "tag_ids" in fields:
        tags = _resolve_tags(db, user, payload.tag_ids or [])
        before, after = sorted(t.name for t in task.tags), sorted(t.name for t in tags)
        if before != after:
            old["tags"], new["tags"] = before, after
            task.tags = tags

    if new:
        _record(db, task, user, "updated", old, new)
    if "status" in fields and payload.status != task.status:
        _apply_status(db, user, task, payload.status, now)  # type: ignore[arg-type]
    db.commit()
    db.refresh(task)
    return task


# --- Status ----------------------------------------------------------------------------------


def _review_required(task: Task) -> bool:
    return False  # personal tasks never require review; organizations configure it (Phase 5)


def _apply_status(db: Session, user: User, task: Task, target: TaskStatus, now: datetime) -> None:
    if task.archived_at is not None:
        raise TaskArchivedError("Archived tasks are read-only. Restore the task to edit it.")
    if target == task.status:
        return
    allowed = allowed_targets(task.status, review_required=_review_required(task))
    if target not in allowed:
        raise InvalidTransitionError(
            f"A task can't move from {task.status.value} to {target.value}.",
            details=[{"field": "status", "message": f"Allowed: {', '.join(sorted(allowed))}"}],
        )
    if target == TaskStatus.COMPLETED:
        open_subtasks = [s for s in task.subtasks if s.is_open]
        if open_subtasks:
            raise OpenSubtasksError(
                f"Finish or cancel {len(open_subtasks)} open subtask(s) "
                "before completing this task."
            )

    previous = task.status
    task.status = target
    if target == TaskStatus.COMPLETED:
        task.completed_at = now
        task.completed_by = user.id
        _record(db, task, user, "completed", {"status": previous.value}, {"status": target.value})
    elif previous == TaskStatus.COMPLETED:
        # Reopen: current state is no longer complete; the earlier event stays in history.
        _record(
            db,
            task,
            user,
            "reopened",
            {"status": previous.value, "completed_at": _jsonable(task.completed_at)},
            {"status": target.value},
        )
        task.completed_at = None
        task.completed_by = None
    else:
        _record(
            db, task, user, "status_changed", {"status": previous.value}, {"status": target.value}
        )


def complete_task(db: Session, user: User, task: Task, now: datetime) -> Task:
    _apply_status(db, user, task, TaskStatus.COMPLETED, now)
    db.commit()
    db.refresh(task)
    return task


def reopen_task(db: Session, user: User, task: Task, now: datetime) -> Task:
    if task.status != TaskStatus.COMPLETED:
        raise InvalidTransitionError("Only completed tasks can be reopened.")
    _apply_status(db, user, task, REOPEN_STATUS, now)
    db.commit()
    db.refresh(task)
    return task


def archive_task(db: Session, user: User, task: Task, now: datetime) -> Task:
    if task.parent_task_id is not None:
        raise TaskValidationError(
            "task", "Subtasks can't be archived on their own; delete them instead."
        )
    if task.archived_at is None:
        task.archived_at = now
        _record(db, task, user, "archived")
        db.commit()
        db.refresh(task)
    return task


def restore_task(db: Session, user: User, task: Task) -> Task:
    if task.archived_at is not None:
        task.archived_at = None
        _record(db, task, user, "restored")
        db.commit()
        db.refresh(task)
    return task


def delete_personal_task(db: Session, user: User, task: Task) -> None:
    """Permanent delete (owner decision A6 for personal tasks); subtasks and history go too."""
    parent_id = task.parent_task_id
    title = task.title
    db.delete(task)
    if parent_id is not None:
        parent = db.get(Task, parent_id)
        if parent is not None:
            _record(db, parent, user, "subtask_deleted", old={"title": title})
    db.commit()


# --- Listing / views -------------------------------------------------------------------------

_PRIORITY_RANK = case(
    {
        TaskPriority.URGENT: 4,
        TaskPriority.HIGH: 3,
        TaskPriority.MEDIUM: 2,
        TaskPriority.LOW: 1,
    },
    value=Task.priority,
)
_DEFAULT_SORT = {
    "my_day": "due",
    "all": "due",
    "upcoming": "due",
    "completed": "completed",
    "done_today": "completed",
    "archived": "-created",
}


@dataclass
class TaskListQuery:
    view: str = "all"
    statuses: list[TaskStatus] = field(default_factory=list)
    priorities: list[TaskPriority] = field(default_factory=list)
    tag_ids: list[int] = field(default_factory=list)
    overdue: bool | None = None
    q: str | None = None
    sort: str | None = None


def _view_conditions(view: str, user: User, now: datetime) -> list[ColumnElement[bool]]:
    """Documented view definitions (FR-PER-03); day boundaries use the user's timezone."""
    tz = zone(user.timezone)
    today = local_today(now, tz)
    _, tomorrow_start = day_bounds_utc(today, tz)
    is_open = Task.status.in_(OPEN_STATUSES)
    active = Task.archived_at.is_(None)
    if view == "my_day":
        # Overdue, due today, or scheduled to start by today.
        return [
            active,
            is_open,
            or_(Task.due_at < tomorrow_start, Task.start_at < tomorrow_start),
        ]
    if view == "upcoming":
        horizon = day_start_utc(today + timedelta(days=UPCOMING_DAYS + 1), tz)
        return [active, is_open, Task.due_at >= tomorrow_start, Task.due_at < horizon]
    if view == "completed":
        return [active, Task.status == TaskStatus.COMPLETED]
    if view == "done_today":
        # My Day's "Done today" section: completed since local midnight.
        today_start, _ = day_bounds_utc(today, tz)
        return [active, Task.status == TaskStatus.COMPLETED, Task.completed_at >= today_start]
    if view == "archived":
        return [Task.archived_at.is_not(None)]
    return [active, is_open]  # "all" = My Tasks


def _order_by(sort: str) -> list[UnaryExpression[Any] | ColumnElement[Any]]:
    nulls_last_due = [Task.due_at.is_(None), Task.due_at.asc()]
    return {
        "due": [*nulls_last_due, _PRIORITY_RANK.desc(), Task.id.desc()],
        "-due": [Task.due_at.is_(None), Task.due_at.desc(), Task.id.desc()],
        "priority": [_PRIORITY_RANK.desc(), *nulls_last_due, Task.id.desc()],
        "-priority": [_PRIORITY_RANK.asc(), *nulls_last_due, Task.id.desc()],
        "created": [Task.created_at.asc(), Task.id.asc()],
        "-created": [Task.created_at.desc(), Task.id.desc()],
        "title": [Task.title.asc(), Task.id.asc()],
        "completed": [Task.completed_at.desc(), Task.id.desc()],
    }[sort]


def list_personal_tasks(
    db: Session, user: User, query: TaskListQuery, *, offset: int, limit: int, now: datetime
) -> tuple[list[Task], int]:
    conditions: list[ColumnElement[bool]] = [
        policies.personal_tasks_of(user),
        Task.parent_task_id.is_(None),  # subtasks are shown inside their parent
        *_view_conditions(query.view, user, now),
    ]
    if query.statuses:
        conditions.append(Task.status.in_(query.statuses))
    if query.priorities:
        conditions.append(Task.priority.in_(query.priorities))
    if query.tag_ids:
        conditions.append(
            exists().where(task_tags.c.task_id == Task.id, task_tags.c.tag_id.in_(query.tag_ids))
        )
    if query.overdue is True:
        conditions += [Task.status.in_(OPEN_STATUSES), Task.due_at < now]
    elif query.overdue is False:
        conditions.append(or_(Task.due_at.is_(None), Task.due_at >= now))
    if query.q:
        escaped = query.q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        conditions.append(Task.title.like(f"%{escaped}%", escape="\\"))

    total = db.scalar(select(func.count()).select_from(Task).where(*conditions)) or 0
    sort = query.sort or _DEFAULT_SORT[query.view]
    items = db.scalars(
        select(Task).where(*conditions).order_by(*_order_by(sort)).offset(offset).limit(limit)
    ).all()
    return list(items), total


# --- Tags ------------------------------------------------------------------------------------


def list_tags(db: Session, user: User) -> list[Tag]:
    return list(
        db.scalars(select(Tag).where(Tag.owner_user_id == user.id).order_by(Tag.name)).all()
    )


def create_tag(db: Session, user: User, payload: TagCreate) -> Tag:
    tag = Tag(owner_user_id=user.id, name=payload.name, color=payload.color)
    db.add(tag)
    _commit_tag(db)
    db.refresh(tag)
    return tag


def update_tag(db: Session, user: User, tag: Tag, payload: TagUpdate) -> Tag:
    if payload.name is not None:
        tag.name = payload.name
    if payload.color is not None:
        tag.color = payload.color
    _commit_tag(db)
    db.refresh(tag)
    return tag


def delete_tag(db: Session, tag: Tag) -> None:
    db.delete(tag)
    db.commit()


def _commit_tag(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise TagNameTakenError("You already have a tag with that name.") from exc
