import hashlib
import math
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import Integer, String, text
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.core.config import get_settings
from app.core.exceptions import AppError
from app.db.base import MYSQL_TABLE_ARGS, Base, UtcDateTime, utc_now


class RateLimitBucket(Base):
    """Fixed-window counters (ADR-009). Moves to Redis in Phase 8 without changing call sites."""

    __tablename__ = "rate_limit_buckets"
    __table_args__ = MYSQL_TABLE_ARGS

    bucket_key: Mapped[str] = mapped_column(String(100), primary_key=True)
    window_start: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    hits: Mapped[int] = mapped_column(Integer, nullable=False)


@dataclass(frozen=True)
class RateLimit:
    action: str
    limit: int
    window: timedelta


class RateLimitedError(AppError):
    status_code = 429
    code = "rate_limited"

    def __init__(self, retry_after_seconds: int) -> None:
        super().__init__(
            "Too many attempts. Please wait and try again.",
            headers={"Retry-After": str(retry_after_seconds)},
        )


def _bucket_key(rule: RateLimit, identity: str) -> str:
    # Hash the identity so emails/IPs are not stored in clear text.
    digest = hashlib.sha256(f"{rule.action}:{identity}".encode()).hexdigest()[:40]
    return f"{rule.action[:50]}:{digest}"


def hit(db: Session, rule: RateLimit, identity: str) -> None:
    """Counts one attempt and raises RateLimitedError when the window's limit is exceeded.

    The upsert is a single atomic statement, so concurrent requests cannot both slip under the
    limit. It commits immediately so attempts are counted even when the request later fails.
    """
    if not get_settings().rate_limits_enabled:
        return
    now = utc_now()
    window_floor = now - rule.window
    key = _bucket_key(rule, identity)
    db.execute(
        text(
            "INSERT INTO rate_limit_buckets (bucket_key, window_start, hits) "
            "VALUES (:key, :now, 1) "
            "ON DUPLICATE KEY UPDATE "
            "  hits = IF(window_start < :floor, 1, hits + 1), "
            "  window_start = IF(window_start < :floor, :now, window_start)"
        ),
        {"key": key, "now": now, "floor": window_floor},
    )
    bucket = db.get(RateLimitBucket, key, populate_existing=True)
    db.commit()
    if bucket is not None and bucket.hits > rule.limit:
        reset_at = bucket.window_start + rule.window
        raise RateLimitedError(max(1, math.ceil((reset_at - now).total_seconds())))
