from datetime import date
from typing import Literal

from pydantic import BaseModel

from app.common.schemas import UtcDateTime

Period = Literal["7d", "30d", "90d"]


class DashboardCounts(BaseModel):
    due_today: int
    overdue: int
    upcoming_7d: int
    open: int
    completed_in_period: int
    created_in_period: int


class OnTimeStats(BaseModel):
    eligible: int
    on_time: int
    rate: float | None  # None when no eligible tasks (avoid a misleading 0%)


class TrendPoint(BaseModel):
    date: date
    completed: int
    created: int


class PersonalDashboard(BaseModel):
    period: Period
    period_start: UtcDateTime
    generated_at: UtcDateTime
    timezone: str
    counts: DashboardCounts
    on_time: OnTimeStats
    trend: list[TrendPoint]
    open_by_priority: dict[str, int]
    open_by_status: dict[str, int]
    definitions: dict[str, str]
