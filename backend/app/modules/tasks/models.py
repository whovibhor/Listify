import enum
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Column,
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import MYSQL_TABLE_ARGS, Base, IdType, TimestampMixin, UtcDateTime, utc_now
from app.modules.organizations.models import Department
from app.modules.users.models import User


class WorkspaceType(enum.StrEnum):
    PERSONAL = "personal"
    ORGANIZATION = "organization"


class TaskStatus(enum.StrEnum):
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    BLOCKED = "blocked"
    IN_REVIEW = "in_review"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


TERMINAL_STATUSES = frozenset({TaskStatus.COMPLETED, TaskStatus.CANCELLED})
OPEN_STATUSES = frozenset(set(TaskStatus) - TERMINAL_STATUSES)


class TaskPriority(enum.StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


class TaskVisibility(enum.StrEnum):
    # Who can see an organization task beyond its creator, assignee and collaborators (ADR-027).
    # Personal tasks are always private.
    PRIVATE = "private"
    DEPARTMENT = "department"
    SELECTED = "selected"
    ORGANIZATION = "organization"


class TagColor(enum.StrEnum):
    # Named palette slots; the frontend maps them to theme-aware colors.
    GRAY = "gray"
    VIOLET = "violet"
    BLUE = "blue"
    TEAL = "teal"
    GREEN = "green"
    AMBER = "amber"
    ORANGE = "orange"
    RED = "red"
    PINK = "pink"


def _enum(cls: type[enum.Enum], name: str) -> Enum:
    # VARCHAR + CHECK (not native ENUM) so later phases can add values without ALTER ... ENUM.
    return Enum(
        cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=20,
        values_callable=lambda members: [m.value for m in members],
    )


task_tags = Table(
    "task_tags",
    Base.metadata,
    Column("task_id", IdType, ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", IdType, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
    Index("ix_task_tags_tag_id", "tag_id"),
    **MYSQL_TABLE_ARGS,
)


class Tag(Base):
    """Belongs to one person (`owner_user_id`) or one organization (`organization_id`), never both.

    Not a CHECK: MySQL forbids one on a column with ON DELETE CASCADE. Only the two services that
    create tags write these columns, and each sets exactly one.
    """

    __tablename__ = "tags"
    __table_args__ = (
        Index("uq_tags_owner_user_id_name", "owner_user_id", "name", unique=True),
        UniqueConstraint("organization_id", "name", name="uq_tags_organization_id_name"),
        MYSQL_TABLE_ARGS,
    )

    id: Mapped[int] = mapped_column(IdType, primary_key=True, autoincrement=True)
    owner_user_id: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    organization_id: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    color: Mapped[TagColor] = mapped_column(
        _enum(TagColor, "tag_color"), nullable=False, default=TagColor.GRAY
    )
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utc_now)


class Task(TimestampMixin, Base):
    """A unit of work.

    Personal tasks: workspace_type='personal', owner_user_id set, visible only to that owner.
    Organization tasks: organization_id set, access decided by `policies.visible_tasks`. Their
    subtasks carry only the organization_id, because access follows the parent.
    """

    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint(
            "workspace_type <> 'personal' OR owner_user_id IS NOT NULL",
            name="personal_has_owner",
        ),
        CheckConstraint(
            "workspace_type <> 'personal' OR (organization_id IS NULL AND department_id IS NULL)",
            name="personal_has_no_organization",
        ),
        CheckConstraint(
            "workspace_type <> 'organization' "
            "OR (organization_id IS NOT NULL AND owner_user_id IS NULL)",
            name="organization_scope",
        ),
        CheckConstraint(
            "visibility <> 'department' OR department_id IS NOT NULL",
            name="department_visibility_has_department",
        ),
        CheckConstraint("char_length(title) > 0", name="title_not_empty"),
        # Composite keys: a task can't point at another organization's department.
        ForeignKeyConstraint(
            ["organization_id", "department_id"],
            ["departments.organization_id", "departments.id"],
            name="fk_tasks_department",
        ),
        ForeignKeyConstraint(
            ["organization_id", "completed_department_id"],
            ["departments.organization_id", "departments.id"],
            name="fk_tasks_completed_department",
        ),
        Index(
            "ix_tasks_owner_archived_status_due",
            "owner_user_id",
            "archived_at",
            "status",
            "due_at",
        ),
        Index("ix_tasks_owner_completed_at", "owner_user_id", "completed_at"),
        Index("ix_tasks_parent_task_id", "parent_task_id"),
        Index(
            "ix_tasks_org_department_archived_status",
            "organization_id",
            "department_id",
            "archived_at",
            "status",
        ),
        Index(
            "ix_tasks_org_assignee_archived_status",
            "organization_id",
            "assigned_to",
            "archived_at",
            "status",
        ),
        MYSQL_TABLE_ARGS,
    )

    id: Mapped[int] = mapped_column(IdType, primary_key=True, autoincrement=True)
    workspace_type: Mapped[WorkspaceType] = mapped_column(
        _enum(WorkspaceType, "workspace_type"), nullable=False
    )
    # RESTRICT, not CASCADE: MySQL forbids referential actions on columns used in CHECK
    # constraints, and users are deactivated rather than deleted anyway.
    owner_user_id: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    organization_id: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=True
    )
    department_id: Mapped[int | None] = mapped_column(IdType, nullable=True)
    created_by: Mapped[int] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    assigned_to: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    parent_task_id: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True
    )

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[TaskStatus] = mapped_column(
        _enum(TaskStatus, "task_status"), nullable=False, default=TaskStatus.NOT_STARTED
    )
    priority: Mapped[TaskPriority] = mapped_column(
        _enum(TaskPriority, "task_priority"), nullable=False, default=TaskPriority.MEDIUM
    )
    visibility: Mapped[TaskVisibility] = mapped_column(
        _enum(TaskVisibility, "task_visibility"), nullable=False, default=TaskVisibility.PRIVATE
    )

    start_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    due_all_day: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    estimated_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    actual_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    completed_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    completed_by: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Snapshot at completion, so moving a task later doesn't rewrite history (ADR-020).
    completed_department_id: Mapped[int | None] = mapped_column(IdType, nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)

    tags: Mapped[list[Tag]] = relationship(secondary=task_tags, lazy="selectin", order_by=Tag.name)
    subtasks: Mapped[list["Task"]] = relationship(
        lazy="selectin",
        order_by=lambda: (Task.sort_order, Task.id),
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    creator: Mapped[User] = relationship(foreign_keys=[created_by], viewonly=True)
    assignee: Mapped[User | None] = relationship(foreign_keys=[assigned_to], viewonly=True)
    department: Mapped[Department | None] = relationship(
        primaryjoin=lambda: Task.department_id == Department.id,
        foreign_keys=[department_id],
        viewonly=True,
    )
    collaborator_links: Mapped[list["TaskCollaborator"]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True
    )
    visibility_grants: Mapped[list["TaskVisibilityGrant"]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True
    )

    @property
    def is_open(self) -> bool:
        return self.status not in TERMINAL_STATUSES


class TaskCollaborator(Base):
    """Someone contributing to a task. It gives access to this task only (PRD §5.6.2)."""

    __tablename__ = "task_collaborators"
    __table_args__ = (Index("ix_task_collaborators_user_id", "user_id"), MYSQL_TABLE_ARGS)

    task_id: Mapped[int] = mapped_column(
        IdType, ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True
    )
    added_by: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utc_now)

    user: Mapped[User] = relationship(foreign_keys=[user_id], viewonly=True)


class TaskVisibilityGrant(Base):
    """Someone a Selected users task is shown to. They can read it, not change it."""

    __tablename__ = "task_visibility_grants"
    __table_args__ = (Index("ix_task_visibility_grants_user_id", "user_id"), MYSQL_TABLE_ARGS)

    task_id: Mapped[int] = mapped_column(
        IdType, ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True
    )
    granted_by: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utc_now)

    user: Mapped[User] = relationship(foreign_keys=[user_id], viewonly=True)


class TaskActivity(Base):
    """Append-only history of meaningful task changes (PRD §5.7)."""

    __tablename__ = "task_activity_logs"
    __table_args__ = (
        Index("ix_task_activity_logs_task_id_created_at", "task_id", "created_at"),
        MYSQL_TABLE_ARGS,
    )

    id: Mapped[int] = mapped_column(IdType, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(
        IdType, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    actor_id: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    old_value: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    new_value: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utc_now)
