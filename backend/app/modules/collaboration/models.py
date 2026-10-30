import enum
from datetime import datetime

from sqlalchemy import Computed, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import MYSQL_TABLE_ARGS, Base, IdType, TimestampMixin, UtcDateTime, utc_now
from app.modules.organizations.models import str_enum
from app.modules.tasks.models import Task
from app.modules.users.models import User


class UpdateRequestStatus(enum.StrEnum):
    PENDING = "pending"
    RESPONDED = "responded"
    CANCELLED = "cancelled"


class TaskComment(TimestampMixin, Base):
    """Separate from the activity history (PRD §5.7). Deleting keeps the row and hides the text."""

    __tablename__ = "task_comments"
    __table_args__ = (
        Index("ix_task_comments_task_id_created_at", "task_id", "created_at"),
        MYSQL_TABLE_ARGS,
    )

    id: Mapped[int] = mapped_column(IdType, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(
        IdType, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[int] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    edited_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    deleted_by: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    author: Mapped[User] = relationship(foreign_keys=[author_id], lazy="joined", viewonly=True)
    task: Mapped[Task] = relationship(viewonly=True)


class TaskAttachment(Base):
    """A stored file. `storage_key` is random; `filename` is shown, never used as a path."""

    __tablename__ = "task_attachments"
    __table_args__ = (
        Index("ix_task_attachments_task_id_created_at", "task_id", "created_at"),
        MYSQL_TABLE_ARGS,
    )

    id: Mapped[int] = mapped_column(IdType, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(
        IdType, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    uploaded_by: Mapped[int] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utc_now)

    uploader: Mapped[User] = relationship(lazy="joined", viewonly=True)
    task: Mapped[Task] = relationship(viewonly=True)


class TaskUpdateRequest(TimestampMixin, Base):
    """A request for progress on a task (PRD §5.8)."""

    __tablename__ = "task_update_requests"
    __table_args__ = (
        # MySQL has no partial unique indexes: this column is the recipient only while pending,
        # so the database itself allows one open request per person per task.
        UniqueConstraint("task_id", "pending_recipient_id", name="uq_task_update_requests_pending"),
        Index("ix_task_update_requests_recipient_id_status", "recipient_id", "status"),
        MYSQL_TABLE_ARGS,
    )

    id: Mapped[int] = mapped_column(IdType, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(
        IdType, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    requester_id: Mapped[int] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    recipient_id: Mapped[int] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    message: Mapped[str] = mapped_column(String(1000), nullable=False)
    respond_by: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    status: Mapped[UpdateRequestStatus] = mapped_column(
        str_enum(UpdateRequestStatus, "update_request_status"),
        nullable=False,
        default=UpdateRequestStatus.PENDING,
    )
    pending_recipient_id: Mapped[int | None] = mapped_column(
        IdType, Computed("if(status = 'pending', recipient_id, NULL)", persisted=True)
    )
    response_note: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    responded_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)

    requester: Mapped[User] = relationship(foreign_keys=[requester_id], viewonly=True)
    recipient: Mapped[User] = relationship(foreign_keys=[recipient_id], viewonly=True)
    task: Mapped[Task] = relationship(viewonly=True)
