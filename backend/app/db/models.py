"""Imports every ORM model so Base.metadata is complete (Alembic autogenerate, test setup)."""

from app.common.rate_limit import RateLimitBucket
from app.modules.audit_logs.models import AuditLog
from app.modules.auth.models import PasswordResetToken, UserSession
from app.modules.collaboration.models import TaskAttachment, TaskComment, TaskUpdateRequest
from app.modules.memberships.models import (
    DepartmentMembership,
    MembershipRequest,
    MembershipRole,
    OrganizationInvitation,
    OrganizationMembership,
)
from app.modules.notifications.models import Notification
from app.modules.organizations.models import Department, Organization
from app.modules.permissions.models import Permission, Role, role_permissions
from app.modules.tasks.models import Tag, Task, TaskActivity, task_tags
from app.modules.users.models import User, UserPreferences

__all__ = [
    "AuditLog",
    "Department",
    "DepartmentMembership",
    "MembershipRequest",
    "MembershipRole",
    "Notification",
    "Organization",
    "OrganizationInvitation",
    "OrganizationMembership",
    "PasswordResetToken",
    "Permission",
    "RateLimitBucket",
    "Role",
    "Tag",
    "Task",
    "TaskActivity",
    "TaskAttachment",
    "TaskComment",
    "TaskUpdateRequest",
    "User",
    "UserPreferences",
    "UserSession",
    "role_permissions",
    "task_tags",
]
