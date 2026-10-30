"""Timezone helpers (ADR-019): the DB stores naive UTC; day boundaries use the user's zone."""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo


def zone(name: str) -> ZoneInfo:
    return ZoneInfo(name)


def to_naive_utc(value: datetime) -> datetime:
    return value.astimezone(UTC).replace(tzinfo=None)


def local_to_utc(day: date, at: time, tz: ZoneInfo) -> datetime:
    """Local wall-clock date/time in `tz` → naive UTC. DST gaps resolve forward (fold=0)."""
    return to_naive_utc(datetime.combine(day, at, tzinfo=tz))


def utc_to_local(value: datetime, tz: ZoneInfo) -> datetime:
    return value.replace(tzinfo=UTC).astimezone(tz)


def local_today(now_utc: datetime, tz: ZoneInfo) -> date:
    return utc_to_local(now_utc, tz).date()


def day_start_utc(day: date, tz: ZoneInfo) -> datetime:
    return local_to_utc(day, time.min, tz)


def day_bounds_utc(day: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    """[start, end) of a local calendar day, in naive UTC (handles 23/25-hour DST days)."""
    return day_start_utc(day, tz), day_start_utc(day + timedelta(days=1), tz)


# An all-day deadline means "by the end of that local day".
END_OF_DAY = time(23, 59, 59, 999999)
