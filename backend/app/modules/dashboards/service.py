"""Personal dashboard metrics (FR-PER-05, PRD §5.9). Definitions are returned with the data."""

from collections import Counter
from datetime import datetime, timedelta

from sqlalchemy import ColumnElement, func, select
from sqlalchemy.orm import Session

from app.common.time import day_bounds_utc, day_start_utc, local_today, utc_to_local, zone
from app.modules.dashboards.schemas import (
    DashboardCounts,
    OnTimeStats,
    Period,
    PersonalDashboard,
    TrendPoint,
)
from app.modules.tasks import policies
from app.modules.tasks.models import OPEN_STATUSES, Task, TaskPriority, TaskStatus
from app.modules.users.models import User

PERIOD_DAYS: dict[str, int] = {"7d": 7, "30d": 30, "90d": 90}

DEFINITIONS = {
    "scope": "Your personal top-level tasks (subtasks are counted inside their parent).",
    "open": "Tasks not Completed or Cancelled, excluding archived tasks.",
    "overdue": (
        "Open tasks whose deadline is earlier than now. Tasks without a deadline are never overdue."
    ),
    "due_today": "Open tasks due during today in your timezone.",
    "upcoming_7d": "Open tasks due in the next 7 days, starting tomorrow.",
    "completed_in_period": (
        "Tasks whose completion time falls in the period. Reopened tasks no longer count."
    ),
    "created_in_period": "Tasks created in the period, whatever their current status.",
    "on_time": (
        "Of tasks completed in the period that had a deadline, the share completed on or before it."
    ),
    "period": "The selected number of calendar days up to and including today, in your timezone.",
}


def _count(db: Session, *conditions: ColumnElement[bool]) -> int:
    return db.scalar(select(func.count()).select_from(Task).where(*conditions)) or 0


def personal_dashboard(db: Session, user: User, period: Period, now: datetime) -> PersonalDashboard:
    tz = zone(user.timezone)
    today = local_today(now, tz)
    today_start, tomorrow_start = day_bounds_utc(today, tz)
    first_day = today - timedelta(days=PERIOD_DAYS[period] - 1)
    period_start = day_start_utc(first_day, tz)

    mine = [policies.personal_tasks_of(user), Task.parent_task_id.is_(None)]
    open_active = [*mine, Task.archived_at.is_(None), Task.status.in_(OPEN_STATUSES)]
    completed_in_period = [
        *mine,
        Task.status == TaskStatus.COMPLETED,
        Task.completed_at >= period_start,
        Task.completed_at <= now,
    ]

    counts = DashboardCounts(
        due_today=_count(
            db, *open_active, Task.due_at >= today_start, Task.due_at < tomorrow_start
        ),
        overdue=_count(db, *open_active, Task.due_at < now),
        upcoming_7d=_count(
            db,
            *open_active,
            Task.due_at >= tomorrow_start,
            Task.due_at < day_start_utc(today + timedelta(days=8), tz),
        ),
        open=_count(db, *open_active),
        completed_in_period=_count(db, *completed_in_period),
        created_in_period=_count(
            db, *mine, Task.created_at >= period_start, Task.created_at <= now
        ),
    )

    eligible = _count(db, *completed_in_period, Task.due_at.is_not(None))
    on_time = _count(
        db, *completed_in_period, Task.due_at.is_not(None), Task.completed_at <= Task.due_at
    )

    # Trend buckets by *local* calendar day, so a 23:30 completion lands on the right date.
    completed_days = Counter(
        utc_to_local(ts, tz).date()
        for ts in db.scalars(select(Task.completed_at).where(*completed_in_period))
    )
    created_days = Counter(
        utc_to_local(ts, tz).date()
        for ts in db.scalars(
            select(Task.created_at).where(
                *mine, Task.created_at >= period_start, Task.created_at <= now
            )
        )
    )
    trend = [
        TrendPoint(date=day, completed=completed_days[day], created=created_days[day])
        for day in (first_day + timedelta(days=offset) for offset in range(PERIOD_DAYS[period]))
    ]

    by_priority = dict.fromkeys((p.value for p in TaskPriority), 0)
    for priority, total in db.execute(
        select(Task.priority, func.count()).where(*open_active).group_by(Task.priority)
    ):
        by_priority[priority.value] = total
    by_status = dict.fromkeys(
        (s.value for s in TaskStatus if s in OPEN_STATUSES and s != TaskStatus.IN_REVIEW), 0
    )
    for task_status, total in db.execute(
        select(Task.status, func.count()).where(*open_active).group_by(Task.status)
    ):
        by_status[task_status.value] = total

    return PersonalDashboard(
        period=period,
        period_start=period_start,
        generated_at=now,
        timezone=user.timezone,
        counts=counts,
        on_time=OnTimeStats(
            eligible=eligible,
            on_time=on_time,
            rate=round(on_time / eligible, 4) if eligible else None,
        ),
        trend=trend,
        open_by_priority=by_priority,
        open_by_status=by_status,
        definitions=DEFINITIONS,
    )
