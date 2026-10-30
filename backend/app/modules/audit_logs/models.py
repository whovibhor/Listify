from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import MYSQL_TABLE_ARGS, Base, IdType, UtcDateTime, utc_now


class AuditLog(Base):
    """Append-only record of sensitive administrative actions (BR-013). No update/delete API."""

    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_organization_id_created_at", "organization_id", "created_at"),
        MYSQL_TABLE_ARGS,
    )

    id: Mapped[int] = mapped_column(IdType, primary_key=True, autoincrement=True)
    organization_id: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=True
    )
    actor_id: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    target_type: Mapped[str] = mapped_column(String(40), nullable=False)
    target_id: Mapped[int | None] = mapped_column(IdType, nullable=True)
    details: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utc_now)
