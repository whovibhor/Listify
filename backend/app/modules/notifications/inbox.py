"""Reading the inbox. Access is checked here, at read time, never remembered from sending."""

from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.db.base import utc_now
from app.modules.collaboration.models import TaskUpdateRequest, UpdateRequestStatus
from app.modules.notifications.models import Notification
from app.modules.notifications.schemas import InboxFilter, InboxSummary, NotificationRead
from app.modules.permissions.service import OrgContext, load_context
from app.modules.tasks import policies
from app.modules.tasks.models import Task
from app.modules.users.models import User

ASSIGNMENT_TYPES = ("assigned", "collaborator_added")
UPDATE_REQUEST_TYPES = ("update_requested", "update_responded", "update_cancelled")


def visible_task_ids(db: Session, user: User, tasks: list[tuple[int, int]]) -> set[int]:
    """Of these (task id, organization id) pairs, the tasks the user can see right now."""
    contexts: dict[int, OrgContext | None] = {}
    visible: set[int] = set()
    for organization_id in {organization_id for _, organization_id in tasks}:
        try:
            contexts[organization_id] = load_context(db, user, organization_id)
        except NotFoundError:
            contexts[organization_id] = None
    for organization_id, context in contexts.items():
        if context is None:
            continue
        ids = [task_id for task_id, owner in tasks if owner == organization_id]
        visible |= set(
            db.scalars(select(Task.id).where(Task.id.in_(ids), policies.visible_tasks(context)))
        )
    return visible


def _conditions(user: User, inbox_filter: InboxFilter) -> list:
    conditions = [Notification.user_id == user.id]
    if inbox_filter == "unread":
        conditions.append(Notification.read_at.is_(None))
    elif inbox_filter == "assignments":
        conditions.append(Notification.type.in_(ASSIGNMENT_TYPES))
    elif inbox_filter == "update_requests":
        conditions.append(Notification.type.in_(UPDATE_REQUEST_TYPES))
    return conditions


def list_inbox(
    db: Session, user: User, inbox_filter: InboxFilter, *, offset: int, limit: int
) -> tuple[list[NotificationRead], int]:
    conditions = _conditions(user, inbox_filter)
    total = db.scalar(select(func.count()).select_from(Notification).where(*conditions)) or 0
    rows = db.scalars(
        select(Notification)
        .where(*conditions)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()

    task_ids = {row.task_id for row in rows if row.task_id is not None}
    tasks = (
        {
            task.id: task
            for task in db.execute(
                select(Task.id, Task.title, Task.organization_id).where(Task.id.in_(task_ids))
            )
        }
        if task_ids
        else {}
    )
    visible = visible_task_ids(
        db,
        user,
        [(task.id, task.organization_id) for task in tasks.values() if task.organization_id],
    )
    actor_ids = {row.actor_id for row in rows if row.actor_id is not None}
    actors = {
        row.id: row.name
        for row in db.execute(select(User.id, User.name).where(User.id.in_(actor_ids)))
    }

    items = []
    for row in rows:
        task = tasks.get(row.task_id) if row.task_id else None
        hidden = row.task_id is not None and (task is None or task.id not in visible)
        items.append(
            NotificationRead(
                id=row.id,
                type=row.type,
                read=row.read_at is not None,
                created_at=row.created_at,
                accessible=not hidden,
                actor_name=None if hidden else actors.get(row.actor_id),
                organization_id=None if hidden else row.organization_id,
                task=None
                if hidden or task is None
                else {
                    "id": task.id,
                    "title": task.title,
                    "organization_id": task.organization_id,
                },
                data={} if hidden else (row.data or {}),
            )
        )
    return items, total


def summary(db: Session, user: User) -> InboxSummary:
    unread = (
        db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        )
        or 0
    )
    pending = db.execute(
        select(Task.id, Task.organization_id)
        .join(TaskUpdateRequest, TaskUpdateRequest.task_id == Task.id)
        .where(
            TaskUpdateRequest.recipient_id == user.id,
            TaskUpdateRequest.status == UpdateRequestStatus.PENDING,
        )
    ).all()
    visible = visible_task_ids(db, user, [(row.id, row.organization_id) for row in pending])
    return InboxSummary(
        unread=unread, pending_update_requests=sum(1 for row in pending if row.id in visible)
    )


def mark_read(db: Session, user: User, notification_id: int, now: datetime | None = None) -> None:
    notification = db.scalar(
        select(Notification).where(
            Notification.id == notification_id, Notification.user_id == user.id
        )
    )
    if notification is None:
        raise NotFoundError("Notification not found.")
    if notification.read_at is None:
        notification.read_at = now or utc_now()
        db.commit()


def mark_all_read(db: Session, user: User) -> None:
    db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=utc_now())
    )
    db.commit()
