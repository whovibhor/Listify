"""Task authorization (ADR-010). Every task read or write goes through these functions.

Phase 2 implements the personal branch: a personal task is visible only to its owner.
Organization rules (membership, department, visibility, collaborators) extend this module in
Phase 5 without changing call sites.
"""

from sqlalchemy import ColumnElement, and_, select
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.modules.tasks.models import Tag, Task, WorkspaceType
from app.modules.users.models import User


def personal_tasks_of(user: User) -> ColumnElement[bool]:
    """WHERE clause selecting exactly the personal tasks `user` may see."""
    return and_(Task.workspace_type == WorkspaceType.PERSONAL, Task.owner_user_id == user.id)


def can_view_task(user: User, task: Task) -> bool:
    if task.workspace_type == WorkspaceType.PERSONAL:
        return task.owner_user_id == user.id
    return False  # organization tasks: Phase 5


def can_edit_task(user: User, task: Task) -> bool:
    return can_view_task(user, task)


def get_task_for_user(db: Session, user: User, task_id: int, *, for_update: bool = False) -> Task:
    """Loads a task the user can access, or raises 404.

    404 (not 403) for tasks that exist but belong to someone else, so IDs can't be probed.
    """
    statement = select(Task).where(Task.id == task_id)
    if for_update:
        statement = statement.with_for_update()
    task = db.scalar(statement)
    if task is None or not can_view_task(user, task):
        raise NotFoundError("Task not found.")
    return task


def tags_owned_by(db: Session, user: User, tag_ids: list[int]) -> list[Tag]:
    if not tag_ids:
        return []
    return list(
        db.scalars(select(Tag).where(Tag.id.in_(tag_ids), Tag.owner_user_id == user.id)).all()
    )


def get_tag_for_user(db: Session, user: User, tag_id: int) -> Tag:
    tag = db.scalar(select(Tag).where(Tag.id == tag_id, Tag.owner_user_id == user.id))
    if tag is None:
        raise NotFoundError("Tag not found.")
    return tag
