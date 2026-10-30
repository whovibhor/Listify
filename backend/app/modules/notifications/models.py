from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import MYSQL_TABLE_ARGS, Base, IdType, UtcDateTime, utc_now


class Notification(Base):
    """One thing to tell one person.

    It deliberately holds no task title or comment text, only references. What's shown is worked
    out when it's read, so someone who has lost access can't learn anything from an old row
    (PRD §5.8). `data` holds only facts about the recipient's own membership.
    """

    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notifications_user_id_read_at_created_at", "user_id", "read_at", "created_at"),
        Index("ix_notifications_user_id_created_at", "user_id", "created_at"),
        MYSQL_TABLE_ARGS,
    )

    id: Mapped[int] = mapped_column(IdType, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    actor_id: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    organization_id: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    task_id: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True
    )
    data: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utc_now)
