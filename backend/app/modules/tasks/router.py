from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, status

from app.common.pagination import Page, PageParams, page_params
from app.db.base import utc_now
from app.modules.auth.dependencies import CurrentAuth, DbSession
from app.modules.tasks import policies, service
from app.modules.tasks.models import TaskPriority, TaskStatus
from app.modules.tasks.schemas import (
    ActivityRead,
    TagCreate,
    TagRead,
    TagUpdate,
    TaskCreate,
    TaskDetail,
    TaskRead,
    TaskUpdate,
)

router = APIRouter(tags=["tasks"])

View = Literal["my_day", "all", "upcoming", "completed", "done_today", "archived"]
Sort = Literal["due", "-due", "priority", "-priority", "created", "-created", "title", "completed"]


# --- Personal task collection ----------------------------------------------------------------


@router.get("/me/tasks", response_model=Page[TaskRead])
def list_my_tasks(
    auth: CurrentAuth,
    db: DbSession,
    paging: PageParams = Depends(page_params),
    view: View = "all",
    status_filter: Annotated[list[TaskStatus], Query(alias="status")] = [],  # noqa: B006
    priority: Annotated[list[TaskPriority], Query()] = [],  # noqa: B006
    tag: Annotated[list[int], Query(max_length=20)] = [],  # noqa: B006
    overdue: bool | None = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    sort: Sort | None = None,
) -> Page[TaskRead]:
    now = utc_now()
    query = service.TaskListQuery(
        view=view,
        statuses=status_filter,
        priorities=priority,
        tag_ids=tag,
        overdue=overdue,
        q=q.strip() if q else None,
        sort=sort,
    )
    items, total = service.list_personal_tasks(
        db, auth.user, query, offset=paging.offset, limit=paging.page_size, now=now
    )
    return Page[TaskRead](
        items=[service.to_read(task, now) for task in items],
        page=paging.page,
        page_size=paging.page_size,
        total=total,
    )


@router.post("/me/tasks", response_model=TaskDetail, status_code=status.HTTP_201_CREATED)
def create_my_task(payload: TaskCreate, auth: CurrentAuth, db: DbSession) -> TaskDetail:
    task = service.create_personal_task(db, auth.user, payload)
    return service.to_detail(task, utc_now())


# --- Single task -----------------------------------------------------------------------------


@router.get("/tasks/{task_id}", response_model=TaskDetail)
def read_task(task_id: int, auth: CurrentAuth, db: DbSession) -> TaskDetail:
    task = policies.get_task_for_user(db, auth.user, task_id)
    return service.to_detail(task, utc_now())


@router.patch("/tasks/{task_id}", response_model=TaskDetail)
def update_task(task_id: int, payload: TaskUpdate, auth: CurrentAuth, db: DbSession) -> TaskDetail:
    now = utc_now()
    task = policies.get_task_for_user(db, auth.user, task_id, for_update=True)
    task = service.update_task(db, auth.user, task, payload, now)
    return service.to_detail(task, now)


@router.post("/tasks/{task_id}/complete", response_model=TaskDetail)
def complete_task(task_id: int, auth: CurrentAuth, db: DbSession) -> TaskDetail:
    now = utc_now()
    task = policies.get_task_for_user(db, auth.user, task_id, for_update=True)
    return service.to_detail(service.complete_task(db, auth.user, task, now), now)


@router.post("/tasks/{task_id}/reopen", response_model=TaskDetail)
def reopen_task(task_id: int, auth: CurrentAuth, db: DbSession) -> TaskDetail:
    now = utc_now()
    task = policies.get_task_for_user(db, auth.user, task_id, for_update=True)
    return service.to_detail(service.reopen_task(db, auth.user, task, now), now)


@router.post("/tasks/{task_id}/archive", response_model=TaskDetail)
def archive_task(task_id: int, auth: CurrentAuth, db: DbSession) -> TaskDetail:
    now = utc_now()
    task = policies.get_task_for_user(db, auth.user, task_id, for_update=True)
    return service.to_detail(service.archive_task(db, auth.user, task, now), now)


@router.post("/tasks/{task_id}/restore", response_model=TaskDetail)
def restore_task(task_id: int, auth: CurrentAuth, db: DbSession) -> TaskDetail:
    task = policies.get_task_for_user(db, auth.user, task_id, for_update=True)
    return service.to_detail(service.restore_task(db, auth.user, task), utc_now())


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: int, auth: CurrentAuth, db: DbSession) -> None:
    task = policies.get_task_for_user(db, auth.user, task_id, for_update=True)
    service.delete_personal_task(db, auth.user, task)


@router.get("/tasks/{task_id}/activity", response_model=list[ActivityRead])
def task_activity(task_id: int, auth: CurrentAuth, db: DbSession) -> list[ActivityRead]:
    task = policies.get_task_for_user(db, auth.user, task_id)
    return service.list_activity(db, task)


# --- Personal tags ---------------------------------------------------------------------------


@router.get("/me/tags", response_model=list[TagRead])
def list_my_tags(auth: CurrentAuth, db: DbSession) -> list[TagRead]:
    return [TagRead.model_validate(tag) for tag in service.list_tags(db, auth.user)]


@router.post("/me/tags", response_model=TagRead, status_code=status.HTTP_201_CREATED)
def create_my_tag(payload: TagCreate, auth: CurrentAuth, db: DbSession) -> TagRead:
    return TagRead.model_validate(service.create_tag(db, auth.user, payload))


@router.patch("/me/tags/{tag_id}", response_model=TagRead)
def update_my_tag(tag_id: int, payload: TagUpdate, auth: CurrentAuth, db: DbSession) -> TagRead:
    tag = policies.get_tag_for_user(db, auth.user, tag_id)
    return TagRead.model_validate(service.update_tag(db, auth.user, tag, payload))


@router.delete("/me/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_tag(tag_id: int, auth: CurrentAuth, db: DbSession) -> None:
    service.delete_tag(db, policies.get_tag_for_user(db, auth.user, tag_id))
