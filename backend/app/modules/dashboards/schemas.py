from datetime import date
from typing import Literal

from pydantic import BaseModel

from app.common.schemas import UtcDateTime
from app.modules.memberships.models import MembershipStatus
from app.modules.organizations.schemas import DepartmentRead
from app.modules.tasks.models import TaskPriority, TaskStatus
from app.modules.tasks.schemas import DepartmentRef, PersonRef

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


# --- Organization reports ------------------------------------------------------------------------


class ReportPeriod(BaseModel):
    start: date
    end: date
    timezone: str
    generated_at: UtcDateTime


class ReportCounts(BaseModel):
    open: int
    overdue: int
    blocked: int
    completed: int
    created: int


class DepartmentWorkload(BaseModel):
    id: int | None  # None is work that isn't in any department
    name: str
    archived: bool
    open: int
    overdue: int
    blocked: int
    completed: int


class OrganizationDashboard(BaseModel):
    period: ReportPeriod
    counts: ReportCounts
    on_time: OnTimeStats
    trend: list[TrendPoint]
    departments: list[DepartmentWorkload]
    definitions: dict[str, str]


class AssigneeWorkload(BaseModel):
    user: PersonRef | None  # None is unassigned work
    in_department: bool  # whether their summary can be opened from this report
    open: int
    overdue: int
    blocked: int
    completed: int


class ReportTask(BaseModel):
    id: int
    title: str
    status: TaskStatus
    assignee: PersonRef | None
    due_at: UtcDateTime | None
    due_all_day: bool
    completed_at: UtcDateTime | None


class DepartmentDashboard(BaseModel):
    period: ReportPeriod
    department: DepartmentRef
    archived: bool
    counts: ReportCounts
    on_time: OnTimeStats
    trend: list[TrendPoint]
    by_status: dict[str, int]
    by_assignee: list[AssigneeWorkload]
    overdue_tasks: list[ReportTask]
    blocked_tasks: list[ReportTask]
    recent_completions: list[ReportTask]
    definitions: dict[str, str]


class DepartmentSummary(BaseModel):
    """What anyone in a department may see: team totals, never one person's numbers."""

    period: ReportPeriod
    department: DepartmentRead
    managers: list[PersonRef]
    counts: ReportCounts
    trend: list[TrendPoint]
    definitions: dict[str, str]


class MemberActivity(BaseModel):
    user_id: int
    name: str
    status: MembershipStatus
    open: int
    overdue: int
    completed: int


class MemberReportCounts(BaseModel):
    assigned: int
    overdue: int
    blocked: int
    completed: int
    pending_update_requests: int


class MemberDepartmentWorkload(BaseModel):
    id: int | None
    name: str
    open: int


class MemberReportProfile(BaseModel):
    user_id: int
    name: str
    job_title: str | None
    status: MembershipStatus
    departments: list[DepartmentRef]


class MemberSummary(BaseModel):
    period: ReportPeriod
    member: MemberReportProfile
    is_self: bool
    counts: MemberReportCounts
    by_status: dict[str, int]
    by_priority: dict[TaskPriority, int]
    by_department: list[MemberDepartmentWorkload]
    definitions: dict[str, str]
