"""Imports every ORM model so Base.metadata is complete (Alembic autogenerate, test setup)."""

from app.common.rate_limit import RateLimitBucket
from app.modules.auth.models import PasswordResetToken, UserSession
from app.modules.tasks.models import Tag, Task, TaskActivity, task_tags
from app.modules.users.models import User

__all__ = [
    "PasswordResetToken",
    "RateLimitBucket",
    "Tag",
    "Task",
    "TaskActivity",
    "User",
    "UserSession",
    "task_tags",
]
