from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.common import rate_limit
from app.common.time import END_OF_DAY, local_to_utc, zone
from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.db.base import utc_now
from app.modules.collaboration.models import TaskUpdateRequest, UpdateRequestStatus
from app.modules.collaboration.schemas import (
    PendingUpdateRequest,
    UpdateRequestCreate,
    UpdateRequestRead,
    UpdateRequestRespond,
)
from app.modules.notifications.inbox import visible_task_ids
from app.modules.notifications.service import notify
from app.modules.permissions.service import load_context
from app.modules.tasks import organization as organization_tasks
from app.modules.tasks import policies, service
from app.modules.tasks.models import Task
from app.modules.tasks.policies import TaskAccess
from app.modules.tasks.schemas import PersonRef
from app.modules.tasks.service import TaskArchivedError, TaskValidationError
from app.modules.users.models import User

UPDATE_REQUESTS_PER_USER = rate_limit.RateLimit("update-request:user", 200, timedelta(hours=1))


class UpdateRequestPendingError(ConflictError):
    code = "update_request_pending"


class UpdateRequestClosedError(ConflictError):
    code = "update_request_closed"


def _can_cancel(request: TaskUpdateRequest, access: TaskAccess, user: User) -> bool:
    if request.status != UpdateRequestStatus.PENDING:
        return False
    return request.requester_id == user.id or access.can("request_update")


def _to_read(request: TaskUpdateRequest, access: TaskAccess, user: User) -> UpdateRequestRead:
    return UpdateRequestRead(
        id=request.id,
        task_id=request.task_id,
        requester=PersonRef(id=request.requester.id, name=request.requester.name),
        recipient=PersonRef(id=request.recipient.id, name=request.recipient.name),
        message=request.message,
        respond_by=request.respond_by,
        status=request.status,
        response_note=request.response_note,
        responded_at=request.responded_at,
        created_at=request.created_at,
        can_respond=request.status == UpdateRequestStatus.PENDING
        and request.recipient_id == user.id,
        can_cancel=_can_cancel(request, access, user),
    )


def list_for_task(db: Session, access: TaskAccess, user: User) -> list[UpdateRequestRead]:
    requests = db.scalars(
        select(TaskUpdateRequest)
        .where(TaskUpdateRequest.task_id == access.task.id)
        .order_by(TaskUpdateRequest.created_at.desc(), TaskUpdateRequest.id.desc())
        .limit(200)
    ).all()
    return [_to_read(request, access, user) for request in requests]


def create(
    db: Session, access: TaskAccess, user: User, payload: UpdateRequestCreate
) -> UpdateRequestRead:
    task = access.task
    if access.context is None:
        raise TaskValidationError("task", "Update requests are for organization tasks.")
    access.require("request_update")
    if task.parent_task_id is not None:
        raise TaskValidationError("task", "Ask about the parent task.")
    if task.archived_at is not None:
        raise TaskArchivedError("Archived tasks are read-only. Restore the task first.")
    if payload.recipient_id == user.id:
        raise TaskValidationError("recipient_id", "You can't request an update from yourself.")
    on_task = payload.recipient_id == task.assigned_to or any(
        link.user_id == payload.recipient_id for link in task.collaborator_links
    )
    if not on_task:
        raise TaskValidationError(
            "recipient_id", "Choose the task's assignee or one of its collaborators."
        )
    if not policies.user_can_view(db, task, payload.recipient_id):
        raise TaskValidationError("recipient_id", "That person can't see this task any more.")
    rate_limit.hit(db, UPDATE_REQUESTS_PER_USER, str(user.id))

    respond_by = None
    if payload.respond_by is not None:
        tz = zone(access.context.organization.timezone)
        respond_by = local_to_utc(payload.respond_by, END_OF_DAY, tz)
    request = TaskUpdateRequest(
        task_id=task.id,
        requester_id=user.id,
        recipient_id=payload.recipient_id,
        message=payload.message,
        respond_by=respond_by,
    )
    db.add(request)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise UpdateRequestPendingError("They already have an open request on this task.") from exc
    service.record(
        db, task, user, "update_requested", new={"name": db.get(User, payload.recipient_id).name}
    )
    db.commit()
    db.refresh(request)
    notify(
        db,
        [request.recipient_id],
        "update_requested",
        actor_id=user.id,
        organization_id=task.organization_id,
        task_id=task.id,
    )
    return _to_read(request, access, user)


def _load(db: Session, user: User, request_id: int) -> tuple[TaskUpdateRequest, TaskAccess]:
    request = db.get(TaskUpdateRequest, request_id)
    if request is None:
        raise NotFoundError("Update request not found.")
    try:
        access = policies.get_access(db, user, request.task_id, for_update=True)
    except NotFoundError as exc:
        raise NotFoundError("Update request not found.") from exc
    return request, access


def respond(
    db: Session, user: User, request_id: int, payload: UpdateRequestRespond
) -> UpdateRequestRead:
    request, access = _load(db, user, request_id)
    if request.recipient_id != user.id:
        raise ForbiddenError("Only the person asked can respond.")
    if request.status != UpdateRequestStatus.PENDING:
        raise UpdateRequestClosedError("This request has already been closed.")
    if access.task.archived_at is not None:
        raise TaskArchivedError("Archived tasks are read-only. Restore the task first.")
    if payload.status is not None and payload.status != access.task.status:
        access.require("edit")
        service.apply_status(db, access, user, payload.status, utc_now())

    request.status = UpdateRequestStatus.RESPONDED
    request.response_note = payload.response_note
    request.responded_at = utc_now()
    service.record(db, access.task, user, "update_responded", new={"name": user.name})
    db.commit()
    db.refresh(request)
    notify(
        db,
        [request.requester_id],
        "update_responded",
        actor_id=user.id,
        organization_id=access.task.organization_id,
        task_id=access.task.id,
    )
    return _to_read(request, access, user)


def cancel(db: Session, user: User, request_id: int) -> UpdateRequestRead:
    request, access = _load(db, user, request_id)
    if request.status != UpdateRequestStatus.PENDING:
        raise UpdateRequestClosedError("This request has already been closed.")
    if not _can_cancel(request, access, user):
        raise ForbiddenError("You can't cancel this request.")
    request.status = UpdateRequestStatus.CANCELLED
    service.record(db, access.task, user, "update_cancelled", old={"name": request.recipient.name})
    db.commit()
    db.refresh(request)
    notify(
        db,
        [request.recipient_id],
        "update_cancelled",
        actor_id=user.id,
        organization_id=access.task.organization_id,
        task_id=access.task.id,
    )
    return _to_read(request, access, user)


def list_pending_for_me(db: Session, user: User) -> list[PendingUpdateRequest]:
    """Filtered at read time: a request on a task they can no longer see simply isn't listed."""
    requests = db.scalars(
        select(TaskUpdateRequest)
        .where(
            TaskUpdateRequest.recipient_id == user.id,
            TaskUpdateRequest.status == UpdateRequestStatus.PENDING,
        )
        .order_by(TaskUpdateRequest.created_at.desc())
        .limit(100)
    ).all()
    tasks = {
        task.id: task
        for task in db.scalars(
            select(Task).where(Task.id.in_([request.task_id for request in requests]))
        )
    }
    visible = visible_task_ids(db, user, [(t.id, t.organization_id) for t in tasks.values()])
    items = []
    for request in requests:
        if request.task_id not in visible:
            continue
        task = tasks[request.task_id]
        access = TaskAccess(
            task=task, root=task, context=load_context(db, user, task.organization_id)
        )
        items.append(
            PendingUpdateRequest(
                **_to_read(request, access, user).model_dump(),
                task_title=task.title,
                organization_id=task.organization_id,
                allowed_statuses=organization_tasks.allowed_statuses(access),
            )
        )
    return items
