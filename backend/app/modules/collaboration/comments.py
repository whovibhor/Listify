from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common import rate_limit
from app.core.exceptions import ForbiddenError, NotFoundError
from app.db.base import utc_now
from app.modules.collaboration.models import TaskComment
from app.modules.collaboration.schemas import CommentCreate, CommentRead, CommentUpdate
from app.modules.notifications.service import notify
from app.modules.tasks import policies, service
from app.modules.tasks.policies import TaskAccess
from app.modules.tasks.schemas import PersonRef
from app.modules.tasks.service import TaskArchivedError, TaskValidationError
from app.modules.users.models import User

COMMENTS_PER_USER = rate_limit.RateLimit("comment:user", 300, timedelta(hours=1))
MAX_COMMENTS_SHOWN = 500


def _can_moderate(access: TaskAccess) -> bool:
    """Owners and Admins can remove any comment. Nobody can rewrite someone else's words."""
    return access.context is not None and access.context.can("task.view_all")


def _to_read(comment: TaskComment, access: TaskAccess, user: User) -> CommentRead:
    deleted = comment.deleted_at is not None
    is_author = comment.author_id == user.id
    return CommentRead(
        id=comment.id,
        task_id=comment.task_id,
        author=PersonRef(id=comment.author.id, name=comment.author.name),
        body=None if deleted else comment.body,
        deleted=deleted,
        edited=comment.edited_at is not None,
        created_at=comment.created_at,
        can_edit=is_author and not deleted,
        can_delete=not deleted and (is_author or _can_moderate(access)),
    )


def _require_commentable(access: TaskAccess) -> None:
    if access.context is not None:
        access.context.require("task.comment")
    if access.task.parent_task_id is not None:
        raise TaskValidationError("task", "Comment on the parent task.")
    if access.task.archived_at is not None:
        raise TaskArchivedError("Archived tasks are read-only. Restore the task to comment.")


def list_comments(db: Session, access: TaskAccess, user: User) -> list[CommentRead]:
    comments = db.scalars(
        select(TaskComment)
        .where(TaskComment.task_id == access.task.id)
        .order_by(TaskComment.created_at, TaskComment.id)
        .limit(MAX_COMMENTS_SHOWN)
    ).all()
    return [_to_read(comment, access, user) for comment in comments]


def add_comment(db: Session, access: TaskAccess, user: User, payload: CommentCreate) -> CommentRead:
    _require_commentable(access)
    task = access.task
    mentions = set(payload.mention_user_ids)
    if mentions and access.context is None:
        raise TaskValidationError("mention_user_ids", "Personal tasks have no one to mention.")
    # Mentioning someone must not be a way to tell them about a task they can't see.
    for mentioned in mentions:
        if not policies.user_can_view(db, task, mentioned):
            raise TaskValidationError("mention_user_ids", "That person can't see this task.")
    rate_limit.hit(db, COMMENTS_PER_USER, str(user.id))

    comment = TaskComment(task_id=task.id, author_id=user.id, body=payload.body)
    db.add(comment)
    service.record(db, task, user, "comment_added")
    db.commit()
    db.refresh(comment)

    if access.context is not None:
        people = {task.created_by, task.assigned_to}
        people |= {link.user_id for link in task.collaborator_links}
        reference = {"organization_id": task.organization_id, "task_id": task.id}
        notify(db, people - mentions, "comment", actor_id=user.id, **reference)
        notify(db, mentions, "mention", actor_id=user.id, **reference)
    return _to_read(comment, access, user)


def _load(db: Session, user: User, comment_id: int) -> tuple[TaskComment, TaskAccess]:
    comment = db.get(TaskComment, comment_id)
    if comment is None:
        raise NotFoundError("Comment not found.")
    # Comments are as visible as their task, and no more.
    try:
        access = policies.get_access(db, user, comment.task_id)
    except NotFoundError as exc:
        raise NotFoundError("Comment not found.") from exc
    return comment, access


def edit_comment(db: Session, user: User, comment_id: int, payload: CommentUpdate) -> CommentRead:
    comment, access = _load(db, user, comment_id)
    if comment.author_id != user.id:
        raise ForbiddenError("You can only edit your own comments.")
    if comment.deleted_at is not None:
        raise NotFoundError("Comment not found.")
    _require_commentable(access)
    if payload.body != comment.body:
        comment.body = payload.body
        comment.edited_at = utc_now()
        db.commit()
    return _to_read(comment, access, user)


def delete_comment(db: Session, user: User, comment_id: int) -> None:
    comment, access = _load(db, user, comment_id)
    if comment.deleted_at is not None:
        raise NotFoundError("Comment not found.")
    if comment.author_id != user.id and not _can_moderate(access):
        raise ForbiddenError("You can only delete your own comments.")
    comment.deleted_at = utc_now()
    comment.deleted_by = user.id
    service.record(db, access.task, user, "comment_deleted")
    db.commit()
