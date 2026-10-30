import logging
from collections.abc import Iterable
from typing import Any

from sqlalchemy.orm import Session

from app.modules.notifications.models import Notification

logger = logging.getLogger("listify.notifications")


def notify(
    db: Session,
    user_ids: Iterable[int | None],
    notification_type: str,
    *,
    actor_id: int | None = None,
    organization_id: int | None = None,
    task_id: int | None = None,
    data: dict[str, Any] | None = None,
) -> None:
    """Call after the change has committed: a failure here must not undo it (PRD §13).

    Nobody is notified about their own action. Never put a task title or comment text in `data`.
    """
    recipients = {user_id for user_id in user_ids if user_id is not None} - {actor_id}
    if not recipients:
        return
    try:
        db.add_all(
            Notification(
                user_id=user_id,
                type=notification_type,
                actor_id=actor_id,
                organization_id=organization_id,
                task_id=task_id,
                data=data,
            )
            for user_id in recipients
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception(
            "Could not save a notification",
            extra={"extra_fields": {"type": notification_type, "task_id": task_id}},
        )
