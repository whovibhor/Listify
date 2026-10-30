"""Organization tasks (Phase 5): scope, people, visibility, boards. Rules are in ADR-027.

Fields shared with personal tasks (title, dates, status...) stay in `service.py`.
"""

from dataclasses import dataclass, field
from datetime import date, datetime

from sqlalchemy import ColumnElement, exists, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.common import rate_limit
from app.common.time import day_bounds_utc, day_start_utc, zone
from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.modules.audit_logs import service as audit
from app.modules.memberships.models import (
    DepartmentMembership,
    MembershipStatus,
    OrganizationMembership,
)
from app.modules.organizations.models import Department, DepartmentStatus
from app.modules.permissions.service import OrgContext
from app.modules.tasks import policies, service
from app.modules.tasks.models import (
    OPEN_STATUSES,
    Tag,
    Task,
    TaskCollaborator,
    TaskPriority,
    TaskStatus,
    TaskVisibility,
    TaskVisibilityGrant,
    WorkspaceType,
    task_tags,
)
from app.modules.tasks.policies import TaskAccess
from app.modules.tasks.schemas import (
    BoardColumn,
    BoardRead,
    DepartmentRef,
    OrganizationTaskCreate,
    PersonRef,
    TagCreate,
    TagUpdate,
    TaskDetail,
    TaskRead,
    TaskUpdate,
)
from app.modules.tasks.service import (
    TaskArchivedError,
    TaskValidationError,
)
from app.modules.tasks.transitions import allowed_targets
from app.modules.users.models import User

BOARD_COLUMN_LIMIT = 100
ORGANIZATION_FIELDS = {"assigned_to", "department_id", "visibility", "visible_to"}

_READ_OPTIONS = (
    selectinload(Task.assignee),
    selectinload(Task.creator),
    selectinload(Task.department),
    selectinload(Task.collaborator_links).joinedload(TaskCollaborator.user),
)


class ArchiveInsteadError(ConflictError):
    code = "archive_instead"


# --- Serialization ---------------------------------------------------------------------------


def _person(user: User | None) -> PersonRef | None:
    return PersonRef(id=user.id, name=user.name) if user else None


def _allowed_statuses(access: TaskAccess) -> list[TaskStatus]:
    task = access.task
    if not access.can("edit") or task.archived_at is not None:
        return []
    review = task.parent_task_id is None and access.org.organization.review_required
    targets = allowed_targets(task.status, review_required=review)
    if review and task.status == TaskStatus.IN_REVIEW and not access.can("approve_review"):
        targets = targets - {TaskStatus.COMPLETED}
    return sorted(targets)


def to_read(access: TaskAccess, now: datetime, *, flagged: bool) -> TaskRead:
    task = access.task
    return service.to_read(task, now).model_copy(
        update={
            "department": DepartmentRef(id=task.department.id, name=task.department.name)
            if task.department
            else None,
            "assignee": _person(task.assignee),
            "creator": _person(task.creator),
            "collaborators": [
                PersonRef(id=link.user.id, name=link.user.name)
                for link in sorted(task.collaborator_links, key=lambda link: link.user.name)
            ],
            "needs_reassignment": flagged,
            "allowed_statuses": _allowed_statuses(access),
            "actions": access.actions(),
        }
    )


def to_detail(db: Session, access: TaskAccess, now: datetime) -> TaskDetail:
    task = access.task
    flagged = _flagged(db, [task])
    subtasks = [
        to_read(TaskAccess(task=child, root=task, context=access.context), now, flagged=False)
        for child in task.subtasks
    ]
    return TaskDetail(
        **to_read(access, now, flagged=task.id in flagged).model_dump(),
        subtasks=subtasks,
        visible_to=[
            PersonRef(id=grant.user.id, name=grant.user.name)
            for grant in sorted(task.visibility_grants, key=lambda grant: grant.user.name)
        ],
    )


def _flagged(db: Session, tasks: list[Task]) -> set[int]:
    if not tasks:
        return set()
    return set(
        db.scalars(
            select(Task.id).where(
                Task.id.in_([task.id for task in tasks]), policies.needs_reassignment()
            )
        )
    )


def _to_reads(db: Session, context: OrgContext, tasks: list[Task], now: datetime) -> list[TaskRead]:
    flagged = _flagged(db, tasks)
    return [
        to_read(TaskAccess(task=task, root=task, context=context), now, flagged=task.id in flagged)
        for task in tasks
    ]


# --- Checks ----------------------------------------------------------------------------------


def _usable_department(db: Session, context: OrgContext, department_id: int) -> Department:
    """A department the member may put work in. Others look like they don't exist (ADR-025)."""
    department = db.scalar(
        select(Department).where(
            Department.id == department_id,
            Department.organization_id == context.organization.id,
        )
    )
    if department is None or not (
        department_id in context.department_ids or context.can("task.view_all")
    ):
        raise NotFoundError("Department not found.")
    if department.status != DepartmentStatus.ACTIVE:
        raise TaskValidationError("department_id", "That department is archived.")
    return department


def _require_active_members(
    db: Session, context: OrgContext, user_ids: set[int], field_name: str
) -> None:
    if not user_ids:
        return
    active = set(
        db.scalars(
            select(OrganizationMembership.user_id).where(
                OrganizationMembership.organization_id == context.organization.id,
                OrganizationMembership.user_id.in_(user_ids),
                OrganizationMembership.status == MembershipStatus.ACTIVE,
            )
        )
    )
    if active != user_ids:
        raise TaskValidationError(field_name, "Choose active members of this organization.")


def _check_assignee(
    db: Session, context: OrgContext, user_id: int, department_id: int | None
) -> None:
    _require_active_members(db, context, {user_id}, "assigned_to")
    if department_id is None:
        return
    in_department = db.scalar(
        select(DepartmentMembership.id).where(
            DepartmentMembership.department_id == department_id,
            DepartmentMembership.user_id == user_id,
        )
    )
    if in_department is None:
        raise TaskValidationError("assigned_to", "They aren't a member of this department.")


def _check_visibility(
    context: OrgContext,
    visibility: TaskVisibility,
    department_id: int | None,
    selected: set[int],
    *,
    current: TaskVisibility | None = None,
) -> None:
    if visibility == TaskVisibility.DEPARTMENT and department_id is None:
        raise TaskValidationError("visibility", "Choose a department for this visibility.")
    if visibility == TaskVisibility.SELECTED and not selected:
        raise TaskValidationError("visible_to", "Choose at least one person to share it with.")
    if (
        visibility == TaskVisibility.ORGANIZATION
        and current != TaskVisibility.ORGANIZATION
        and not context.can("task.view_all")
    ):
        raise ForbiddenError("Only administrators can share a task with the whole organization.")


# --- Create ----------------------------------------------------------------------------------


def _resolve_tags(db: Session, context: OrgContext, tag_ids: list[int]) -> list[Tag]:
    tags = policies.tags_of_organization(db, context.organization.id, tag_ids)
    if len(tags) != len(tag_ids):
        raise TaskValidationError("tag_ids", "One or more tags don't exist.")
    return tags


def create_task(
    db: Session, context: OrgContext, payload: OrganizationTaskCreate
) -> tuple[Task, TaskAccess]:
    context.require("task.create")
    user = context.user
    rate_limit.hit(db, service.TASKS_PER_USER, str(user.id))
    organization_id = context.organization.id
    if payload.parent_task_id is not None:
        return _create_subtask(db, context, payload)

    department_id = payload.department_id
    if department_id is not None:
        _usable_department(db, context, department_id)
    visibility = payload.visibility or (
        TaskVisibility.DEPARTMENT if department_id is not None else TaskVisibility.PRIVATE
    )
    selected = set(payload.visible_to)
    _check_visibility(context, visibility, department_id, selected)
    if visibility != TaskVisibility.SELECTED:
        selected = set()
    _require_active_members(db, context, selected, "visible_to")

    if payload.assigned_to is not None:
        _check_assignee(db, context, payload.assigned_to, department_id)
    collaborators = set(payload.collaborator_ids)
    if payload.assigned_to in collaborators:
        raise TaskValidationError("collaborator_ids", "The assignee can't also be a collaborator.")
    _require_active_members(db, context, collaborators, "collaborator_ids")

    timezone = context.organization.timezone
    due_at, due_all_day = service.due_from_local(timezone, payload.due_date, payload.due_time)
    task = Task(
        workspace_type=WorkspaceType.ORGANIZATION,
        organization_id=organization_id,
        department_id=department_id,
        created_by=user.id,
        assigned_to=payload.assigned_to,
        visibility=visibility,
        title=payload.title,
        description=payload.description or None,
        status=payload.status,
        priority=payload.priority,
        start_at=service.start_from_local(timezone, payload.start_date),
        due_at=due_at,
        due_all_day=due_all_day,
        estimated_minutes=payload.estimated_minutes,
        tags=_resolve_tags(db, context, payload.tag_ids or []),
    )
    db.add(task)
    db.flush()
    for user_id in collaborators:
        db.add(TaskCollaborator(task_id=task.id, user_id=user_id, added_by=user.id))
    for user_id in selected:
        db.add(TaskVisibilityGrant(task_id=task.id, user_id=user_id, granted_by=user.id))
    service.record(db, task, user, "created", new={"title": task.title})
    if payload.assigned_to is not None:
        service.record(
            db, task, user, "assigned", new={"name": db.get(User, payload.assigned_to).name}
        )
    db.commit()
    db.refresh(task)
    return task, TaskAccess(task=task, root=task, context=context)


def _create_subtask(
    db: Session, context: OrgContext, payload: OrganizationTaskCreate
) -> tuple[Task, TaskAccess]:
    parent_access = policies.get_access(db, context.user, payload.parent_task_id, for_update=True)
    if parent_access.task.organization_id != context.organization.id:
        raise NotFoundError("Task not found.")
    parent_access.require("edit")
    parent = parent_access.task
    sort_order = service.next_subtask_position(parent)
    timezone = context.organization.timezone
    due_at, due_all_day = service.due_from_local(timezone, payload.due_date, payload.due_time)
    task = Task(
        workspace_type=WorkspaceType.ORGANIZATION,
        organization_id=context.organization.id,
        created_by=context.user.id,
        parent_task_id=parent.id,
        title=payload.title,
        description=payload.description or None,
        status=payload.status,
        priority=payload.priority,
        due_at=due_at,
        due_all_day=due_all_day,
        sort_order=sort_order,
    )
    db.add(task)
    db.flush()
    service.record(db, task, context.user, "created", new={"title": task.title})
    service.record(
        db,
        parent,
        context.user,
        "subtask_added",
        new={"title": task.title, "subtask_id": task.id},
    )
    db.commit()
    db.refresh(task)
    return task, TaskAccess(task=task, root=parent, context=context)


# --- Update ----------------------------------------------------------------------------------


def _move(db: Session, access: TaskAccess, target_id: int | None) -> None:
    """Access follows the department immediately, because `visible_tasks` reads it (PRD §13)."""
    context, task = access.org, access.task
    if target_id == task.department_id:
        return
    access.require("move")
    before = task.department.name if task.department else None
    after = None
    if target_id is not None:
        after = _usable_department(db, context, target_id).name
    if not context.can("task.assign", target_id):
        raise ForbiddenError("You can't move tasks into that department.")
    task.department_id = target_id
    service.record(db, task, context.user, "moved", {"department": before}, {"department": after})
    audit.record(
        db,
        organization_id=context.organization.id,
        actor_id=context.user.id,
        action="task.moved",
        target_type="task",
        target_id=task.id,
        details={"title": task.title, "from_department": before, "to_department": after},
    )


def _assign(db: Session, access: TaskAccess, new_id: int | None) -> None:
    context, task = access.org, access.task
    if new_id == task.assigned_to:
        return
    claiming = new_id == context.user.id and task.assigned_to is None
    if not claiming:
        access.require("assign")
    if new_id is not None:
        _check_assignee(db, context, new_id, task.department_id)
        # One role each: becoming the assignee replaces being a collaborator.
        task.collaborator_links[:] = [
            link for link in task.collaborator_links if link.user_id != new_id
        ]
    before = task.assignee.name if task.assignee else None
    after = db.get(User, new_id).name if new_id is not None else None
    task.assigned_to = new_id
    service.record(db, task, context.user, "assigned", {"name": before}, {"name": after})


def _set_visibility(db: Session, access: TaskAccess, payload: TaskUpdate) -> None:
    context, task = access.org, access.task
    access.require("change_visibility")
    fields = payload.model_fields_set
    visibility = payload.visibility if "visibility" in fields else task.visibility
    current_grants = {grant.user_id for grant in task.visibility_grants}
    selected = set(payload.visible_to or []) if "visible_to" in fields else current_grants
    _check_visibility(context, visibility, task.department_id, selected, current=task.visibility)
    if visibility != TaskVisibility.SELECTED:
        selected = set()
    _require_active_members(db, context, selected - current_grants, "visible_to")

    if visibility != task.visibility or selected != current_grants:
        service.record(
            db,
            task,
            context.user,
            "visibility_changed",
            {"visibility": task.visibility.value},
            {"visibility": visibility.value},
        )
    task.visibility = visibility
    task.visibility_grants[:] = [
        grant for grant in task.visibility_grants if grant.user_id in selected
    ]
    for user_id in selected - current_grants:
        task.visibility_grants.append(
            TaskVisibilityGrant(user_id=user_id, granted_by=context.user.id)
        )


def update_task(db: Session, access: TaskAccess, payload: TaskUpdate, now: datetime) -> Task:
    context, task = access.org, access.task
    fields = payload.model_fields_set
    claiming = (
        fields == {"assigned_to"}
        and payload.assigned_to == context.user.id
        and task.assigned_to is None
    )
    if not claiming:
        access.require("edit")
    if fields & ORGANIZATION_FIELDS:
        if task.parent_task_id is not None:
            raise TaskValidationError("task", "Subtasks follow their parent task.")
        if task.archived_at is not None:
            raise TaskArchivedError("Archived tasks are read-only. Restore the task to edit it.")
        if "department_id" in fields:
            _move(db, access, payload.department_id)
        if "assigned_to" in fields:
            _assign(db, access, payload.assigned_to)
        if fields & {"visibility", "visible_to"}:
            _set_visibility(db, access, payload)
        elif task.visibility == TaskVisibility.DEPARTMENT and task.department_id is None:
            raise TaskValidationError(
                "visibility", "Choose a visibility for a task with no department."
            )
    return service.update_task(db, access, context.user, payload, now)


def add_collaborator(db: Session, access: TaskAccess, user_id: int) -> Task:
    context, task = access.context, access.task
    if context is None:
        raise TaskValidationError("task", "Personal tasks don't have collaborators.")
    access.require("manage_collaborators")
    if task.parent_task_id is not None:
        raise TaskValidationError("task", "Add collaborators to the parent task.")
    if task.archived_at is not None:
        raise TaskArchivedError("Archived tasks are read-only. Restore the task to edit it.")
    if user_id == task.assigned_to:
        raise TaskValidationError("user_id", "The assignee can't also be a collaborator.")
    if any(link.user_id == user_id for link in task.collaborator_links):
        return task
    _require_active_members(db, context, {user_id}, "user_id")
    task.collaborator_links.append(TaskCollaborator(user_id=user_id, added_by=context.user.id))
    service.record(
        db, task, context.user, "collaborator_added", new={"name": db.get(User, user_id).name}
    )
    db.commit()
    db.refresh(task)
    return task


def remove_collaborator(db: Session, access: TaskAccess, user_id: int) -> Task:
    context, task = access.context, access.task
    if context is None:
        raise TaskValidationError("task", "Personal tasks don't have collaborators.")
    if user_id != context.user.id:
        access.require("manage_collaborators")
    link = next((link for link in task.collaborator_links if link.user_id == user_id), None)
    if link is None:
        raise NotFoundError("They aren't a collaborator on this task.")
    name = link.user.name
    task.collaborator_links.remove(link)
    service.record(db, task, context.user, "collaborator_removed", old={"name": name})
    db.commit()
    db.refresh(task)
    return task


# --- Lists and the board ---------------------------------------------------------------------


@dataclass
class OrganizationTaskQuery:
    view: str = "team"
    department_id: int | None = None
    assignee_id: int | None = None
    unassigned: bool = False
    creator_id: int | None = None
    statuses: list[TaskStatus] = field(default_factory=list)
    priorities: list[TaskPriority] = field(default_factory=list)
    tag_ids: list[int] = field(default_factory=list)
    overdue: bool | None = None
    due_from: date | None = None
    due_to: date | None = None
    needs_reassignment: bool = False
    q: str | None = None
    sort: str = "due"


def _conditions(
    context: OrgContext, query: OrganizationTaskQuery, now: datetime
) -> list[ColumnElement[bool]]:
    tz = zone(context.organization.timezone)
    conditions: list[ColumnElement[bool]] = [
        policies.visible_tasks(context),
        Task.parent_task_id.is_(None),
    ]
    if query.view == "archived":
        conditions.append(Task.archived_at.is_not(None))
    else:
        conditions.append(Task.archived_at.is_(None))
    open_unless_filtered = [Task.status.in_(OPEN_STATUSES)] if not query.statuses else []
    if query.view == "my_work":
        conditions += [Task.assigned_to == context.user.id, *open_unless_filtered]
    elif query.view == "collaborating":
        conditions += [
            exists().where(
                TaskCollaborator.task_id == Task.id, TaskCollaborator.user_id == context.user.id
            ),
            *open_unless_filtered,
        ]

    if query.department_id is not None:
        conditions.append(Task.department_id == query.department_id)
    if query.unassigned:
        conditions.append(Task.assigned_to.is_(None))
    elif query.assignee_id is not None:
        conditions.append(Task.assigned_to == query.assignee_id)
    if query.creator_id is not None:
        conditions.append(Task.created_by == query.creator_id)
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
    if query.due_from is not None:
        conditions.append(Task.due_at >= day_start_utc(query.due_from, tz))
    if query.due_to is not None:
        conditions.append(Task.due_at < day_bounds_utc(query.due_to, tz)[1])
    if query.needs_reassignment:
        conditions.append(policies.needs_reassignment())
    if query.q:
        escaped = query.q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        conditions.append(Task.title.like(f"%{escaped}%", escape="\\"))
    return conditions


def list_tasks(
    db: Session,
    context: OrgContext,
    query: OrganizationTaskQuery,
    *,
    offset: int,
    limit: int,
    now: datetime,
) -> tuple[list[TaskRead], int]:
    context.require("task.view_own")
    conditions = _conditions(context, query, now)
    total = db.scalar(select(func.count()).select_from(Task).where(*conditions)) or 0
    tasks = db.scalars(
        select(Task)
        .where(*conditions)
        .options(*_READ_OPTIONS)
        .order_by(*service.order_by(query.sort))
        .offset(offset)
        .limit(limit)
    ).all()
    return _to_reads(db, context, list(tasks), now), total


def get_board(
    db: Session,
    context: OrgContext,
    department_id: int,
    query: OrganizationTaskQuery,
    now: datetime,
) -> BoardRead:
    """Only members of the department (and administrators) can open its board (BR-006).

    Being a collaborator on one task isn't enough: that gives access to the task, not the board.
    """
    department = db.scalar(
        select(Department).where(
            Department.id == department_id,
            Department.organization_id == context.organization.id,
        )
    )
    if department is None or not (
        department_id in context.department_ids or context.can("task.view_all")
    ):
        raise NotFoundError("Department not found.")

    query.department_id = department_id
    columns = []
    for status in TaskStatus:
        conditions = [*_conditions(context, query, now), Task.status == status]
        total = db.scalar(select(func.count()).select_from(Task).where(*conditions)) or 0
        tasks = db.scalars(
            select(Task)
            .where(*conditions)
            .options(*_READ_OPTIONS)
            .order_by(*service.order_by(query.sort))
            .limit(BOARD_COLUMN_LIMIT)
        ).all()
        columns.append(
            BoardColumn(status=status, total=total, items=_to_reads(db, context, list(tasks), now))
        )
    return BoardRead(
        department=DepartmentRef(id=department.id, name=department.name),
        archived=department.status != DepartmentStatus.ACTIVE,
        review_required=context.organization.review_required,
        can_create=department.status == DepartmentStatus.ACTIVE and context.can("task.create"),
        columns=columns,
    )


# --- Tags ------------------------------------------------------------------------------------


def list_tags(db: Session, context: OrgContext) -> list[Tag]:
    return list(
        db.scalars(
            select(Tag).where(Tag.organization_id == context.organization.id).order_by(Tag.name)
        ).all()
    )


def create_tag(db: Session, context: OrgContext, payload: TagCreate) -> Tag:
    context.require("task.create")
    rate_limit.hit(db, service.TAGS_PER_USER, str(context.user.id))
    tag = Tag(organization_id=context.organization.id, name=payload.name, color=payload.color)
    db.add(tag)
    service.commit_tag(db)
    db.refresh(tag)
    return tag


def update_tag(db: Session, context: OrgContext, tag_id: int, payload: TagUpdate) -> Tag:
    context.require("organization.settings.update")
    tag = policies.get_organization_tag(db, context.organization.id, tag_id)
    return service.update_tag(db, tag, payload)


def delete_tag(db: Session, context: OrgContext, tag_id: int) -> None:
    context.require("organization.settings.update")
    service.delete_tag(db, policies.get_organization_tag(db, context.organization.id, tag_id))
