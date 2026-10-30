from typing import Any

from sqlalchemy.orm import Session

from app.modules.audit_logs.models import AuditLog


def record(
    db: Session,
    *,
    organization_id: int | None,
    actor_id: int | None,
    action: str,
    target_type: str,
    target_id: int | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    """Adds an audit row to the caller's transaction: it commits or rolls back with the change."""
    db.add(
        AuditLog(
            organization_id=organization_id,
            actor_id=actor_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            details=details,
        )
    )
