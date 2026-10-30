import logging
import time
from collections.abc import Callable
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import text

from app.db.session import get_engine

logger = logging.getLogger("listify.health")


class DependencyStatus(BaseModel):
    status: Literal["ok", "error"]
    latency_ms: float | None = None


DatabaseProbe = Callable[[], DependencyStatus]


def probe_database() -> DependencyStatus:
    """Runs `SELECT 1` against the configured database. Failures are logged, never exposed."""
    start = time.perf_counter()
    try:
        with get_engine().connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception as exc:
        # One line per failed probe; health is polled, so full tracebacks would flood the log.
        cause = getattr(exc, "orig", None) or exc
        logger.warning(
            "Database health check failed",
            extra={"extra_fields": {"error": f"{type(cause).__name__}: {cause}"}},
        )
        return DependencyStatus(status="error")
    return DependencyStatus(status="ok", latency_ms=round((time.perf_counter() - start) * 1000, 1))


def get_database_probe() -> DatabaseProbe:
    return probe_database
