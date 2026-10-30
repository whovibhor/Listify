"""Task authorization (ADR-010, ADR-027). Every task read or write goes through this module.

`visible_tasks` is the one definition of who can see an organization task: lists, boards, search
and single-task reads all use it, so they can't disagree. What someone may then change is decided
by `TaskAccess`, whose answers also reach the UI as each task's `actions`.
"""

from dataclasses import dataclass

from sqlalchemy import ColumnElement, and_, exists, or_, select
from sqlalchemy.orm import Session

from app.core.exceptions import ForbiddenError, NotFoundError
from app.modules.memberships.models import (
    DepartmentMembership,
    MembershipStatus,
    OrganizationMembership,
)
from app.modules.permissions.service import OrgContext, load_context
from app.modules.tasks.models import (
    OPEN_STATUSES,
    Tag,
    Task,
    TaskCollaborator,
    TaskVisibility,
    TaskVisibilityGrant,
    WorkspaceType,
)
from app.modules.users.models import User


def personal_tasks_of(user: User) -> ColumnElement[bool]:
    """WHERE clause selecting exactly the personal tasks `user` may see."""
    return and_(Task.workspace_type == WorkspaceType.PERSONAL, Task.owner_user_id == user.id)


def visible_tasks(context: OrgContext) -> ColumnElement[bool]:
    """WHERE clause selecting exactly the organization tasks this member may see."""
    in_organization = and_(
        Task.workspace_type == WorkspaceType.ORGANIZATION,
        Task.organization_id == context.organization.id,
    )
    if context.can("task.view_all"):
        return in_organization

    user_id = context.user.id
    paths: list[ColumnElement[bool]] = [
        Task.created_by == user_id,
        Task.assigned_to == user_id,
        exists().where(TaskCollaborator.task_id == Task.id, TaskCollaborator.user_id == user_id),
        and_(
            Task.visibility == TaskVisibility.SELECTED,
            exists().where(
                TaskVisibilityGrant.task_id == Task.id, TaskVisibilityGrant.user_id == user_id
            ),
        ),
    ]
    if context.can("task.view_organization"):
        paths.append(Task.visibility == TaskVisibility.ORGANIZATION)
    if context.department_ids and context.can("task.view_department"):
        paths.append(
            and_(
                Task.visibility == TaskVisibility.DEPARTMENT,
                Task.department_id.in_(list(context.department_ids)),
            )
        )
    return and_(in_organization, or_(*paths))


def needs_reassignment() -> ColumnElement[bool]:
    """Open tasks whose assignee can no longer do them (PRD §13).

    Worked out from memberships rather than stored, so reactivating someone or moving them back
    clears the flag with nothing to keep in sync.
    """
    assignee_is_active = exists().where(
        OrganizationMembership.organization_id == Task.organization_id,
        OrganizationMembership.user_id == Task.assigned_to,
        OrganizationMembership.status == MembershipStatus.ACTIVE,
    )
    assignee_in_department = exists().where(
        DepartmentMembership.department_id == Task.department_id,
        DepartmentMembership.user_id == Task.assigned_to,
    )
    return and_(
        Task.workspace_type == WorkspaceType.ORGANIZATION,
        Task.assigned_to.is_not(None),
        Task.status.in_(OPEN_STATUSES),
        or_(~assignee_is_active, and_(Task.department_id.is_not(None), ~assignee_in_department)),
    )


@dataclass
class TaskAccess:
    """A task the user can see, and what they may do with it.

    `root` is the task itself, or the parent for a subtask: subtasks follow their parent's access.
    `context` is None for personal tasks, where the owner may do everything.
    """

    task: Task
    root: Task
    context: OrgContext | None = None

    @property
    def org(self) -> OrgContext:
        if self.context is None:
            raise TypeError("Personal tasks have no organization context.")
        return self.context

    def _in_department(self, permission: str) -> bool:
        return self.org.can(permission, self.root.department_id)

    def can(self, action: str) -> bool:
        if self.context is None:
            return True
        user_id = self.context.user.id
        # Someone who has left the task's department stops running its work, but can still read
        # what they created (`visible_tasks`).
        is_creator = self.root.created_by == user_id and (
            self.root.department_id is None
            or self.root.department_id in self.context.department_ids
        )
        if action == "edit":
            is_on_task = (
                is_creator
                or self.root.assigned_to == user_id
                or any(link.user_id == user_id for link in self.root.collaborator_links)
            )
            return self.context.can("task.update") and (
                is_on_task or self._in_department("task.assign")
            )
        if action in ("assign", "change_visibility"):
            return is_creator or self._in_department("task.assign")
        if action == "approve_review":
            # Nobody signs off their own work. Owners and Admins can, so that a one-person
            # organization with review switched on can still finish its tasks.
            if self.root.assigned_to == user_id and not self.context.can("task.assign"):
                return False
            return is_creator or self._in_department("task.assign")
        if action == "move":
            return self._in_department("task.assign")
        if action == "manage_collaborators":
            return is_creator or self._in_department("task.manage_collaborators")
        if action == "archive":
            return is_creator or self._in_department("task.delete")
        if action == "request_update":
            return self._in_department("task.request_update")
        raise ValueError(action)

    def require(self, action: str) -> None:
        if not self.can(action):
            raise ForbiddenError("You don't have permission to do that.")

    def actions(self) -> list[str]:
        return [action for action in TASK_ACTIONS if self.can(action)]


TASK_ACTIONS = (
    "edit",
    "assign",
    "change_visibility",
    "approve_review",
    "move",
    "manage_collaborators",
    "archive",
    "request_update",
)


def get_access(db: Session, user: User, task_id: int, *, for_update: bool = False) -> TaskAccess:
    """Loads a task the user can access, or raises 404.

    404 (not 403) for tasks that exist but aren't visible, so IDs can't be probed.
    """
    statement = select(Task).where(Task.id == task_id)
    if for_update:
        statement = statement.with_for_update()
    task = db.scalar(statement)
    if task is None:
        raise NotFoundError("Task not found.")

    if task.workspace_type == WorkspaceType.PERSONAL:
        if task.owner_user_id != user.id:
            raise NotFoundError("Task not found.")
        return TaskAccess(task=task, root=task)

    context = load_context(db, user, task.organization_id)
    root_id = task.parent_task_id or task.id
    if db.scalar(select(Task.id).where(Task.id == root_id, visible_tasks(context))) is None:
        raise NotFoundError("Task not found.")
    root = task if root_id == task.id else db.get(Task, root_id)
    return TaskAccess(task=task, root=root, context=context)


def user_can_view(db: Session, task: Task, user_id: int) -> bool:
    """Whether someone else can see this task right now, for mentions and update requests."""
    user = db.get(User, user_id)
    if user is None or task.organization_id is None:
        return False
    try:
        context = load_context(db, user, task.organization_id)
    except NotFoundError:
        return False
    root_id = task.parent_task_id or task.id
    return db.scalar(select(Task.id).where(Task.id == root_id, visible_tasks(context))) is not None


def tags_owned_by(db: Session, user: User, tag_ids: list[int]) -> list[Tag]:
    if not tag_ids:
        return []
    return list(
        db.scalars(select(Tag).where(Tag.id.in_(tag_ids), Tag.owner_user_id == user.id)).all()
    )


def tags_of_organization(db: Session, organization_id: int, tag_ids: list[int]) -> list[Tag]:
    if not tag_ids:
        return []
    return list(
        db.scalars(
            select(Tag).where(Tag.id.in_(tag_ids), Tag.organization_id == organization_id)
        ).all()
    )


def get_tag_for_user(db: Session, user: User, tag_id: int) -> Tag:
    tag = db.scalar(select(Tag).where(Tag.id == tag_id, Tag.owner_user_id == user.id))
    if tag is None:
        raise NotFoundError("Tag not found.")
    return tag


def get_organization_tag(db: Session, organization_id: int, tag_id: int) -> Tag:
    tag = db.scalar(select(Tag).where(Tag.id == tag_id, Tag.organization_id == organization_id))
    if tag is None:
        raise NotFoundError("Tag not found.")
    return tag
