from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, status

from app.common.pagination import Page, PageParams, page_params
from app.db.base import utc_now
from app.modules.auth.dependencies import CurrentAuth, DbSession
from app.modules.permissions.service import OrgCtx
from app.modules.tasks import organization, policies, service
from app.modules.tasks.models import TaskPriority, TaskStatus
from app.modules.tasks.policies import TaskAccess
from app.modules.tasks.schemas import (
    MAX_TASK_DATE,
    MIN_TASK_DATE,
    ActivityRead,
    BoardRead,
    CollaboratorAdd,
    OrganizationTaskCreate,
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
OrganizationView = Literal["team", "my_work", "collaborating", "archived"]
Sort = Literal["due", "-due", "priority", "-priority", "created", "-created", "title", "completed"]
TaskDateFilter = Annotated[date | None, Query(ge=MIN_TASK_DATE, le=MAX_TASK_DATE)]


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


# --- Organization tasks ----------------------------------------------------------------------


@router.get("/organizations/{organization_id}/tasks", response_model=Page[TaskRead])
def list_organization_tasks(
    context: OrgCtx,
    db: DbSession,
    paging: PageParams = Depends(page_params),
    view: OrganizationView = "team",
    department_id: int | None = None,
    assignee: int | None = None,
    unassigned: bool = False,
    creator: int | None = None,
    status_filter: Annotated[list[TaskStatus], Query(alias="status")] = [],  # noqa: B006
    priority: Annotated[list[TaskPriority], Query()] = [],  # noqa: B006
    tag: Annotated[list[int], Query(max_length=20)] = [],  # noqa: B006
    overdue: bool | None = None,
    due_from: TaskDateFilter = None,
    due_to: TaskDateFilter = None,
    needs_reassignment: bool = False,
    q: Annotated[str | None, Query(max_length=100)] = None,
    sort: Sort = "due",
) -> Page[TaskRead]:
    query = organization.OrganizationTaskQuery(
        view=view,
        department_id=department_id,
        assignee_id=assignee,
        unassigned=unassigned,
        creator_id=creator,
        statuses=status_filter,
        priorities=priority,
        tag_ids=tag,
        overdue=overdue,
        due_from=due_from,
        due_to=due_to,
        needs_reassignment=needs_reassignment,
        q=q.strip() if q else None,
        sort=sort,
    )
    items, total = organization.list_tasks(
        db, context, query, offset=paging.offset, limit=paging.page_size, now=utc_now()
    )
    return Page[TaskRead](items=items, page=paging.page, page_size=paging.page_size, total=total)


@router.post(
    "/organizations/{organization_id}/tasks",
    response_model=TaskDetail,
    status_code=status.HTTP_201_CREATED,
)
def create_organization_task(
    payload: OrganizationTaskCreate, context: OrgCtx, db: DbSession
) -> TaskDetail:
    _, access = organization.create_task(db, context, payload)
    return organization.to_detail(db, access, utc_now())


@router.get(
    "/organizations/{organization_id}/departments/{department_id}/board",
    response_model=BoardRead,
)
def department_board(
    department_id: int,
    context: OrgCtx,
    db: DbSession,
    assignee: int | None = None,
    unassigned: bool = False,
    creator: int | None = None,
    status_filter: Annotated[list[TaskStatus], Query(alias="status")] = [],  # noqa: B006
    priority: Annotated[list[TaskPriority], Query()] = [],  # noqa: B006
    tag: Annotated[list[int], Query(max_length=20)] = [],  # noqa: B006
    overdue: bool | None = None,
    due_from: TaskDateFilter = None,
    due_to: TaskDateFilter = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
) -> BoardRead:
    query = organization.OrganizationTaskQuery(
        assignee_id=assignee,
        unassigned=unassigned,
        creator_id=creator,
        statuses=status_filter,
        priorities=priority,
        tag_ids=tag,
        overdue=overdue,
        due_from=due_from,
        due_to=due_to,
        q=q.strip() if q else None,
    )
    return organization.get_board(db, context, department_id, query, utc_now())


@router.get("/organizations/{organization_id}/tags", response_model=list[TagRead])
def list_organization_tags(context: OrgCtx, db: DbSession) -> list[TagRead]:
    return [TagRead.model_validate(tag) for tag in organization.list_tags(db, context)]


@router.post(
    "/organizations/{organization_id}/tags",
    response_model=TagRead,
    status_code=status.HTTP_201_CREATED,
)
def create_organization_tag(payload: TagCreate, context: OrgCtx, db: DbSession) -> TagRead:
    return TagRead.model_validate(organization.create_tag(db, context, payload))


@router.patch("/organizations/{organization_id}/tags/{tag_id}", response_model=TagRead)
def update_organization_tag(
    tag_id: int, payload: TagUpdate, context: OrgCtx, db: DbSession
) -> TagRead:
    return TagRead.model_validate(organization.update_tag(db, context, tag_id, payload))


@router.delete(
    "/organizations/{organization_id}/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_organization_tag(tag_id: int, context: OrgCtx, db: DbSession) -> None:
    organization.delete_tag(db, context, tag_id)


# --- Single task -----------------------------------------------------------------------------


def _detail(db: DbSession, access: TaskAccess) -> TaskDetail:
    if access.context is None:
        return service.to_detail(access.task, utc_now())
    return organization.to_detail(db, access, utc_now())


@router.get("/tasks/{task_id}", response_model=TaskDetail)
def read_task(task_id: int, auth: CurrentAuth, db: DbSession) -> TaskDetail:
    return _detail(db, policies.get_access(db, auth.user, task_id))


@router.patch("/tasks/{task_id}", response_model=TaskDetail)
def update_task(task_id: int, payload: TaskUpdate, auth: CurrentAuth, db: DbSession) -> TaskDetail:
    access = policies.get_access(db, auth.user, task_id, for_update=True)
    if access.context is None:
        if payload.model_fields_set & organization.ORGANIZATION_FIELDS:
            raise service.TaskValidationError("task", "These fields are for organization tasks.")
        service.update_task(db, access, auth.user, payload, utc_now())
    else:
        organization.update_task(db, access, payload, utc_now())
    return _detail(db, access)


@router.post("/tasks/{task_id}/complete", response_model=TaskDetail)
def complete_task(task_id: int, auth: CurrentAuth, db: DbSession) -> TaskDetail:
    access = policies.get_access(db, auth.user, task_id, for_update=True)
    access.require("edit")
    service.complete_task(db, access, auth.user, utc_now())
    return _detail(db, access)


@router.post("/tasks/{task_id}/reopen", response_model=TaskDetail)
def reopen_task(task_id: int, auth: CurrentAuth, db: DbSession) -> TaskDetail:
    access = policies.get_access(db, auth.user, task_id, for_update=True)
    access.require("edit")
    service.reopen_task(db, access, auth.user, utc_now())
    return _detail(db, access)


@router.post("/tasks/{task_id}/archive", response_model=TaskDetail)
def archive_task(task_id: int, auth: CurrentAuth, db: DbSession) -> TaskDetail:
    access = policies.get_access(db, auth.user, task_id, for_update=True)
    access.require("archive")
    service.archive_task(db, auth.user, access.task, utc_now())
    return _detail(db, access)


@router.post("/tasks/{task_id}/restore", response_model=TaskDetail)
def restore_task(task_id: int, auth: CurrentAuth, db: DbSession) -> TaskDetail:
    access = policies.get_access(db, auth.user, task_id, for_update=True)
    access.require("archive")
    service.restore_task(db, auth.user, access.task)
    return _detail(db, access)


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: int, auth: CurrentAuth, db: DbSession) -> None:
    access = policies.get_access(db, auth.user, task_id, for_update=True)
    if access.context is not None:
        if access.task.parent_task_id is None:
            raise organization.ArchiveInsteadError("Organization tasks are archived, not deleted.")
        access.require("edit")
    service.delete_task(db, auth.user, access.task)


@router.get("/tasks/{task_id}/activity", response_model=list[ActivityRead])
def task_activity(task_id: int, auth: CurrentAuth, db: DbSession) -> list[ActivityRead]:
    access = policies.get_access(db, auth.user, task_id)
    return service.list_activity(db, access.task)


@router.post("/tasks/{task_id}/collaborators", response_model=TaskDetail)
def add_collaborator(
    task_id: int, payload: CollaboratorAdd, auth: CurrentAuth, db: DbSession
) -> TaskDetail:
    access = policies.get_access(db, auth.user, task_id, for_update=True)
    organization.add_collaborator(db, access, payload.user_id)
    return _detail(db, access)


@router.delete("/tasks/{task_id}/collaborators/{user_id}", response_model=TaskDetail)
def remove_collaborator(task_id: int, user_id: int, auth: CurrentAuth, db: DbSession) -> TaskDetail:
    access = policies.get_access(db, auth.user, task_id, for_update=True)
    organization.remove_collaborator(db, access, user_id)
    return _detail(db, access)


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
    return TagRead.model_validate(service.update_tag(db, tag, payload))


@router.delete("/me/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_tag(tag_id: int, auth: CurrentAuth, db: DbSession) -> None:
    service.delete_tag(db, policies.get_tag_for_user(db, auth.user, tag_id))
