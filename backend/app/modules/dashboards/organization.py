"""Organization, department and member reports (PRD §5.9, ADR-030).

Every number starts from `policies.visible_tasks`, so a report can't count a task its reader
couldn't open. Date boundaries use the organization's timezone (ADR-019). Open work follows the
task's current department; completions stay with the department that finished them (ADR-020).
"""

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import ColumnElement, and_, case, func, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import InstrumentedAttribute

from app.common.time import day_start_utc, local_today, zone
from app.core.exceptions import NotFoundError
from app.modules.collaboration.models import TaskUpdateRequest, UpdateRequestStatus
from app.modules.dashboards.schemas import (
    AssigneeWorkload,
    DepartmentDashboard,
    DepartmentSummary,
    DepartmentWorkload,
    MemberActivity,
    MemberDepartmentWorkload,
    MemberReportCounts,
    MemberReportProfile,
    MemberSummary,
    OnTimeStats,
    OrganizationDashboard,
    ReportCounts,
    ReportPeriod,
    ReportTask,
    TrendPoint,
)
from app.modules.memberships.models import (
    DepartmentMembership,
    MembershipRole,
    MembershipStatus,
    OrganizationMembership,
)
from app.modules.organizations.models import Department, DepartmentStatus
from app.modules.organizations.schemas import DepartmentRead
from app.modules.permissions.catalog import DEPARTMENT_MANAGER
from app.modules.permissions.models import Role
from app.modules.permissions.service import OrgContext
from app.modules.tasks import policies
from app.modules.tasks.models import OPEN_STATUSES, Task, TaskPriority, TaskStatus
from app.modules.tasks.schemas import DepartmentRef, PersonRef
from app.modules.tasks.service import TaskValidationError
from app.modules.users.models import User

DEFAULT_RANGE_DAYS = 30
MAX_RANGE_DAYS = 366
EARLIEST_REPORT_DATE = date(2000, 1, 1)
LIST_LIMIT = 10
NO_DEPARTMENT = "No department"

_SECONDS_PER_DAY = 86_400

SHARED_DEFINITIONS = {
    "open": "Tasks not Completed or Cancelled, excluding archived tasks.",
    "overdue": (
        "Open tasks whose deadline is earlier than now. Tasks without a deadline are never overdue."
    ),
    "blocked": "Open tasks with the status Blocked.",
    "completed": (
        "Tasks whose completion time falls in the period. Reopened tasks no longer count."
    ),
    "created": "Tasks created in the period, whatever their current status.",
    "on_time": (
        "Cohort: tasks completed in the period that had a deadline. "
        "The rate is the share completed on or before that deadline."
    ),
    "period": "Every calendar day from the start date to the end date, in the organization's "
    "timezone.",
}
_ORGANIZATION_DEFINITIONS = {
    **SHARED_DEFINITIONS,
    "scope": "Every top-level task in the organization. Subtasks count inside their parent.",
    "departments": (
        "Open, overdue and blocked use each task's department today. "
        "Completed uses the department it was in when it was completed."
    ),
}
_DEPARTMENT_DEFINITIONS = {
    **SHARED_DEFINITIONS,
    "scope": "Top-level tasks in this department that you can see.",
    "completed": (
        "Tasks completed in this department during the period, even if they have moved since. "
        "Reopened tasks no longer count."
    ),
    "trend": "Completed uses the department at completion. Created uses the department today.",
    "by_assignee": (
        "A count of work, not a measure of performance. "
        "Completed counts tasks assigned to the person when the report runs."
    ),
}
_MEMBER_DEFINITIONS = {
    "scope": "Top-level tasks assigned to this person.",
    "scope_limited": "Top-level tasks assigned to this person that you can see.",
    "assigned": "Open tasks assigned to this person, excluding archived tasks.",
    "overdue": SHARED_DEFINITIONS["overdue"],
    "blocked": SHARED_DEFINITIONS["blocked"],
    "completed": (
        "Tasks assigned to this person and completed in the period. Reopened tasks no longer count."
    ),
    "pending_update_requests": "Update requests waiting for this person's response.",
    "period": SHARED_DEFINITIONS["period"],
    "not_a_score": "These are counts of work. They aren't a measure of anyone's performance.",
}


@dataclass(frozen=True)
class ReportRange:
    start: date
    end: date
    start_utc: datetime
    end_utc: datetime  # exclusive
    tz: ZoneInfo
    day_starts: tuple[int, ...]  # when each local day begins, in MySQL's TO_SECONDS() numbering

    def contains(self, column: InstrumentedAttribute[datetime]) -> ColumnElement[bool]:
        return and_(column >= self.start_utc, column < self.end_utc)


@dataclass(frozen=True)
class ReportScope:
    """`workload` picks the tasks that are this report's work today, `completions` the ones whose
    completion belongs to it. They differ for departments, because tasks can move."""

    workload: tuple[ColumnElement[bool], ...]
    completions: tuple[ColumnElement[bool], ...]


def _to_seconds(value: datetime) -> int:
    """The same number MySQL's TO_SECONDS() gives, which counts from year 0."""
    since_midnight = value.hour * 3600 + value.minute * 60 + value.second
    return (value.toordinal() + 365) * _SECONDS_PER_DAY + since_midnight


def report_range(
    context: OrgContext, start: date | None, end: date | None, now: datetime
) -> ReportRange:
    tz = zone(context.organization.timezone)
    today = local_today(now, tz)
    end = end or today
    start = start or end - timedelta(days=DEFAULT_RANGE_DAYS - 1)
    if end > today:
        raise TaskValidationError("end", "The end date can't be in the future.")
    if start < EARLIEST_REPORT_DATE:
        raise TaskValidationError("start", "Choose a start date from the year 2000 onwards.")
    if start > end:
        raise TaskValidationError("start", "The start date must be on or before the end date.")
    if (end - start).days >= MAX_RANGE_DAYS:
        raise TaskValidationError("end", f"Choose a period of {MAX_RANGE_DAYS} days or fewer.")
    day_starts = tuple(
        _to_seconds(day_start_utc(start + timedelta(days=offset), tz))
        for offset in range((end - start).days + 1)
    )
    return ReportRange(
        start=start,
        end=end,
        start_utc=day_start_utc(start, tz),
        end_utc=day_start_utc(end + timedelta(days=1), tz),
        tz=tz,
        day_starts=day_starts,
    )


def is_open() -> ColumnElement[bool]:
    return and_(Task.archived_at.is_(None), Task.status.in_(OPEN_STATUSES))


def completed_in(period: ReportRange) -> ColumnElement[bool]:
    return and_(Task.status == TaskStatus.COMPLETED, period.contains(Task.completed_at))


def visible_top_level(context: OrgContext) -> tuple[ColumnElement[bool], ...]:
    return (policies.visible_tasks(context), Task.parent_task_id.is_(None))


def organization_scope(context: OrgContext) -> ReportScope:
    visible = visible_top_level(context)
    return ReportScope(workload=visible, completions=visible)


def department_scope(context: OrgContext, department_id: int) -> ReportScope:
    visible = visible_top_level(context)
    return ReportScope(
        workload=(*visible, Task.department_id == department_id),
        completions=(*visible, Task.completed_department_id == department_id),
    )


def _tally(condition: ColumnElement[bool]):
    return func.sum(case((condition, 1), else_=0))


def _period_meta(context: OrgContext, period: ReportRange, now: datetime) -> ReportPeriod:
    return ReportPeriod(
        start=period.start,
        end=period.end,
        timezone=context.organization.timezone,
        generated_at=now,
    )


@dataclass
class OpenWork:
    total: int = 0
    overdue: int = 0
    blocked: int = 0


@dataclass
class ReportData:
    """A report's numbers. Each query below makes one pass over its tasks and yields several of
    them at once, because a pass per number was too slow on large organizations (ADR-030)."""

    open_work: dict[Any, OpenWork] = field(default_factory=lambda: defaultdict(OpenWork))
    open_by_status: dict[str, int] = field(
        default_factory=lambda: dict.fromkeys(
            (status.value for status in TaskStatus if status in OPEN_STATUSES), 0
        )
    )
    completed: Counter[Any] = field(default_factory=Counter)
    completed_days: Counter[date] = field(default_factory=Counter)
    created_days: Counter[date] = field(default_factory=Counter)
    eligible: int = 0
    on_time: int = 0


def _day_number(column: InstrumentedAttribute[datetime], period: ReportRange):
    """Which day of the period a timestamp falls on, starting at 1, worked out by MySQL.

    Comparing with each day's real start keeps this right in every timezone, including on days
    when the clocks change.
    """
    return func.interval(func.to_seconds(column), *period.day_starts).label("day_number")


def _local_day(day_number: int, period: ReportRange) -> date:
    return period.start + timedelta(days=int(day_number) - 1)


def _report_data(
    db: Session,
    scope: ReportScope,
    period: ReportRange,
    now: datetime,
    *,
    open_group: InstrumentedAttribute[int | None],
    completed_group: InstrumentedAttribute[int | None],
) -> ReportData:
    data = ReportData()
    for key, status, total, overdue in db.execute(
        select(open_group, Task.status, func.count(), _tally(Task.due_at < now))
        .where(*scope.workload, is_open())
        .group_by(open_group, Task.status)
    ):
        work = data.open_work[key]
        work.total += total
        work.overdue += int(overdue or 0)
        if status == TaskStatus.BLOCKED:
            work.blocked += total
        data.open_by_status[status.value] += total

    for key, day_number, total, eligible, on_time in db.execute(
        select(
            completed_group,
            _day_number(Task.completed_at, period),
            func.count(),
            _tally(Task.due_at.is_not(None)),
            _tally(Task.completed_at <= Task.due_at),
        )
        .where(*scope.completions, completed_in(period))
        .group_by(completed_group, "day_number")
    ):
        data.completed[key] += total
        data.completed_days[_local_day(day_number, period)] += total
        data.eligible += int(eligible or 0)
        data.on_time += int(on_time or 0)

    for day_number, total in db.execute(
        select(_day_number(Task.created_at, period), func.count())
        .where(*scope.workload, period.contains(Task.created_at))
        .group_by("day_number")
    ):
        data.created_days[_local_day(day_number, period)] += total
    return data


def _counts(data: ReportData) -> ReportCounts:
    work = data.open_work.values()
    return ReportCounts(
        open=sum(item.total for item in work),
        overdue=sum(item.overdue for item in work),
        blocked=sum(item.blocked for item in work),
        completed=data.completed.total(),
        created=data.created_days.total(),
    )


def _on_time(data: ReportData) -> OnTimeStats:
    rate = round(data.on_time / data.eligible, 4) if data.eligible else None
    return OnTimeStats(eligible=data.eligible, on_time=data.on_time, rate=rate)


def _trend(data: ReportData, period: ReportRange) -> list[TrendPoint]:
    days = (period.end - period.start).days + 1
    return [
        TrendPoint(date=day, completed=data.completed_days[day], created=data.created_days[day])
        for day in (period.start + timedelta(days=offset) for offset in range(days))
    ]


def _department_rows(
    db: Session, context: OrgContext, data: ReportData, only: set[int] | None = None
) -> list[DepartmentWorkload]:
    """One row per department. `only` limits it to the departments a reader may report on."""
    departments = db.scalars(
        select(Department)
        .where(Department.organization_id == context.organization.id)
        .order_by(Department.name)
    ).all()

    rows = []
    for department in departments:
        work = data.open_work.get(department.id, OpenWork())
        done = data.completed[department.id]
        archived = department.status != DepartmentStatus.ACTIVE
        hidden = only is not None and department.id not in only
        if hidden or (archived and not (work.total or done)):
            continue
        rows.append(
            DepartmentWorkload(
                id=department.id,
                name=department.name,
                archived=archived,
                open=work.total,
                overdue=work.overdue,
                blocked=work.blocked,
                completed=done,
            )
        )
    work = data.open_work.get(None, OpenWork())
    done = data.completed[None]
    if only is None and (work.total or done):
        rows.append(
            DepartmentWorkload(
                id=None,
                name=NO_DEPARTMENT,
                archived=False,
                open=work.total,
                overdue=work.overdue,
                blocked=work.blocked,
                completed=done,
            )
        )
    return rows


def _organization_data(
    db: Session, context: OrgContext, period: ReportRange, now: datetime
) -> ReportData:
    return _report_data(
        db,
        organization_scope(context),
        period,
        now,
        open_group=Task.department_id,
        completed_group=Task.completed_department_id,
    )


def organization_dashboard(
    db: Session, context: OrgContext, period: ReportRange, now: datetime
) -> OrganizationDashboard:
    context.require("report.view_organization")
    data = _organization_data(db, context, period, now)
    return OrganizationDashboard(
        period=_period_meta(context, period, now),
        counts=_counts(data),
        on_time=_on_time(data),
        trend=_trend(data, period),
        departments=_department_rows(db, context, data),
        definitions=_ORGANIZATION_DEFINITIONS,
    )


def reportable_departments(
    db: Session, context: OrgContext, period: ReportRange, now: datetime
) -> list[DepartmentWorkload]:
    """The departments this person may report on: all of them for Owners and Admins."""
    if context.can("report.view_organization"):
        data = _organization_data(db, context, period, now)
        return [row for row in _department_rows(db, context, data) if row.id is not None]
    context.require_anywhere("report.view_department")
    data = _organization_data(db, context, period, now)
    only = context.departments_with("report.view_department")
    return _department_rows(db, context, data, only=only)


def department_for_report(db: Session, context: OrgContext, department_id: int) -> Department:
    """403 for your own department without the permission, 404 for anyone else's (ADR-010)."""
    department = db.scalar(
        select(Department).where(
            Department.id == department_id,
            Department.organization_id == context.organization.id,
        )
    )
    if department is None or not (
        department_id in context.department_ids
        or context.can("report.view_department", department_id)
    ):
        raise NotFoundError("Department not found.")
    context.require("report.view_department", department_id)
    return department


def _report_tasks(db: Session, statement) -> list[ReportTask]:
    tasks = db.execute(
        statement.add_columns(User.id.label("assignee_id"), User.name.label("assignee_name"))
        .outerjoin(User, User.id == Task.assigned_to)
        .limit(LIST_LIMIT)
    ).all()
    return [
        ReportTask(
            id=row.id,
            title=row.title,
            status=row.status,
            assignee=(
                PersonRef(id=row.assignee_id, name=row.assignee_name)
                if row.assignee_id is not None
                else None
            ),
            due_at=row.due_at,
            due_all_day=row.due_all_day,
            completed_at=row.completed_at,
        )
        for row in tasks
    ]


_REPORT_TASK_COLUMNS = (
    Task.id,
    Task.title,
    Task.status,
    Task.due_at,
    Task.due_all_day,
    Task.completed_at,
)


def _by_assignee(db: Session, data: ReportData, department_id: int) -> list[AssigneeWorkload]:
    user_ids = {key for key in {*data.open_work, *data.completed} if key is not None}
    names = dict(db.execute(select(User.id, User.name).where(User.id.in_(user_ids))).all())
    members = set(
        db.scalars(
            select(DepartmentMembership.user_id).where(
                DepartmentMembership.department_id == department_id
            )
        )
    )

    def row(user_id: int | None) -> AssigneeWorkload:
        work = data.open_work.get(user_id, OpenWork())
        return AssigneeWorkload(
            user=None if user_id is None else PersonRef(id=user_id, name=names[user_id]),
            in_department=user_id in members,
            open=work.total,
            overdue=work.overdue,
            blocked=work.blocked,
            completed=data.completed[user_id],
        )

    people = sorted(user_ids, key=lambda user_id: names[user_id].casefold())
    return [item for item in map(row, [*people, None]) if item.open or item.completed]


def department_dashboard(
    db: Session, context: OrgContext, department_id: int, period: ReportRange, now: datetime
) -> DepartmentDashboard:
    department = department_for_report(db, context, department_id)
    scope = department_scope(context, department_id)
    data = _report_data(
        db, scope, period, now, open_group=Task.assigned_to, completed_group=Task.assigned_to
    )
    columns = select(*_REPORT_TASK_COLUMNS)
    return DepartmentDashboard(
        period=_period_meta(context, period, now),
        department=DepartmentRef(id=department.id, name=department.name),
        archived=department.status != DepartmentStatus.ACTIVE,
        counts=_counts(data),
        on_time=_on_time(data),
        trend=_trend(data, period),
        by_status=data.open_by_status,
        by_assignee=_by_assignee(db, data, department_id),
        overdue_tasks=_report_tasks(
            db,
            columns.where(*scope.workload, is_open(), Task.due_at < now).order_by(
                Task.due_at, Task.id
            ),
        ),
        blocked_tasks=_report_tasks(
            db,
            columns.where(*scope.workload, is_open(), Task.status == TaskStatus.BLOCKED).order_by(
                Task.due_at.is_(None), Task.due_at, Task.id
            ),
        ),
        recent_completions=_report_tasks(
            db,
            columns.where(*scope.completions, completed_in(period)).order_by(
                Task.completed_at.desc(), Task.id.desc()
            ),
        ),
        definitions=_DEPARTMENT_DEFINITIONS,
    )


def _department_members(db: Session, context: OrgContext, department_id: int) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(DepartmentMembership)
            .join(
                OrganizationMembership,
                (OrganizationMembership.user_id == DepartmentMembership.user_id)
                & (OrganizationMembership.organization_id == DepartmentMembership.organization_id),
            )
            .where(
                DepartmentMembership.department_id == department_id,
                OrganizationMembership.organization_id == context.organization.id,
                OrganizationMembership.status == MembershipStatus.ACTIVE,
            )
        )
        or 0
    )


def _department_managers(db: Session, context: OrgContext, department_id: int) -> list[PersonRef]:
    rows = db.execute(
        select(User.id, User.name)
        .join(OrganizationMembership, OrganizationMembership.user_id == User.id)
        .join(MembershipRole, MembershipRole.membership_id == OrganizationMembership.id)
        .join(Role, Role.id == MembershipRole.role_id)
        .where(
            OrganizationMembership.organization_id == context.organization.id,
            OrganizationMembership.status == MembershipStatus.ACTIVE,
            MembershipRole.department_id == department_id,
            Role.key == DEPARTMENT_MANAGER,
        )
        .order_by(User.name)
    ).all()
    return [PersonRef(id=row.id, name=row.name) for row in rows]


def department_summary(
    db: Session, context: OrgContext, department_id: int, now: datetime
) -> DepartmentSummary:
    """For everyone in the department, unlike the report, so it holds only team totals.

    Same people as the board (BR-006). Counts stay within what the reader can see, so they always
    agree with the board in front of them.
    """
    department = db.scalar(
        select(Department).where(
            Department.id == department_id,
            Department.organization_id == context.organization.id,
        )
    )
    if department is None or not (
        department_id in context.department_ids or context.can("task.view_all")
    ):
        raise NotFoundError("Department not found.")

    period = report_range(context, None, None, now)
    data = _report_data(
        db,
        department_scope(context, department_id),
        period,
        now,
        open_group=Task.department_id,
        completed_group=Task.completed_department_id,
    )
    return DepartmentSummary(
        period=_period_meta(context, period, now),
        department=DepartmentRead.model_validate(department).model_copy(
            update={"member_count": _department_members(db, context, department_id)}
        ),
        managers=_department_managers(db, context, department_id),
        counts=_counts(data),
        trend=_trend(data, period),
        definitions=_DEPARTMENT_DEFINITIONS,
    )


def member_activity(
    db: Session,
    context: OrgContext,
    period: ReportRange,
    now: datetime,
    *,
    offset: int,
    limit: int,
) -> tuple[list[MemberActivity], int]:
    """Listed by name, never ranked: the PRD rules out unsupported employee scoring."""
    context.require("report.view_organization")
    conditions = (
        OrganizationMembership.organization_id == context.organization.id,
        OrganizationMembership.status != MembershipStatus.REMOVED,
    )
    total = (
        db.scalar(select(func.count()).select_from(OrganizationMembership).where(*conditions)) or 0
    )
    people = db.execute(
        select(User.id, User.name, OrganizationMembership.status)
        .join(OrganizationMembership, OrganizationMembership.user_id == User.id)
        .where(*conditions)
        .order_by(User.name, User.id)
        .offset(offset)
        .limit(limit)
    ).all()
    user_ids = [person.id for person in people]
    visible = visible_top_level(context)
    workload = {
        user_id: (int(open_total or 0), int(overdue or 0))
        for user_id, open_total, overdue in db.execute(
            select(
                Task.assigned_to,
                _tally(is_open()),
                _tally(and_(is_open(), Task.due_at < now)),
            )
            .where(*visible, Task.assigned_to.in_(user_ids))
            .group_by(Task.assigned_to)
        )
    }
    completed = dict(
        db.execute(
            select(Task.assigned_to, func.count())
            .where(*visible, Task.assigned_to.in_(user_ids), completed_in(period))
            .group_by(Task.assigned_to)
        ).all()
    )
    return [
        MemberActivity(
            user_id=person.id,
            name=person.name,
            status=person.status,
            open=workload.get(person.id, (0, 0))[0],
            overdue=workload.get(person.id, (0, 0))[1],
            completed=completed.get(person.id, 0),
        )
        for person in people
    ], total


def _member_for_report(db: Session, context: OrgContext, user_id: int) -> OrganizationMembership:
    """Yourself, or someone in a department you report on. 403 if you can see them, else 404."""
    membership = db.scalar(
        select(OrganizationMembership).where(
            OrganizationMembership.organization_id == context.organization.id,
            OrganizationMembership.user_id == user_id,
            OrganizationMembership.status != MembershipStatus.REMOVED,
        )
    )
    if membership is None:
        raise NotFoundError("Member not found.")
    if user_id == context.user.id:
        context.require_anywhere("report.view_personal")
        return membership
    if context.can("report.view_organization"):
        return membership
    their_departments = set(
        db.scalars(
            select(DepartmentMembership.department_id).where(
                DepartmentMembership.organization_id == context.organization.id,
                DepartmentMembership.user_id == user_id,
            )
        )
    )
    if any(context.can("report.view_department", dept) for dept in their_departments):
        return membership
    if their_departments & context.department_ids:
        context.require("report.view_organization")
    raise NotFoundError("Member not found.")


def member_summary(
    db: Session, context: OrgContext, user_id: int, period: ReportRange, now: datetime
) -> MemberSummary:
    membership = _member_for_report(db, context, user_id)
    visible = visible_top_level(context)
    assigned = (*visible, Task.assigned_to == user_id)

    by_status: dict[str, int] = dict.fromkeys(
        (status.value for status in TaskStatus if status in OPEN_STATUSES), 0
    )
    by_priority: dict[TaskPriority, int] = dict.fromkeys(TaskPriority, 0)
    by_department: dict[int | None, int] = defaultdict(int)
    open_total = 0
    for status, priority, department_id, total in db.execute(
        select(Task.status, Task.priority, Task.department_id, func.count())
        .where(*assigned, is_open())
        .group_by(Task.status, Task.priority, Task.department_id)
    ):
        by_status[status.value] += total
        by_priority[priority] += total
        by_department[department_id] += total
        open_total += total

    department_names = dict(
        db.execute(
            select(Department.id, Department.name).where(
                Department.organization_id == context.organization.id
            )
        ).all()
    )
    overdue = db.scalar(
        select(func.count()).select_from(Task).where(*assigned, is_open(), Task.due_at < now)
    )
    completed = db.scalar(
        select(func.count()).select_from(Task).where(*assigned, completed_in(period))
    )
    pending = db.scalar(
        select(func.count())
        .select_from(TaskUpdateRequest)
        .join(Task, Task.id == TaskUpdateRequest.task_id)
        .where(
            TaskUpdateRequest.recipient_id == user_id,
            TaskUpdateRequest.status == UpdateRequestStatus.PENDING,
            policies.visible_tasks(context),
        )
    )
    profile_departments = db.execute(
        select(Department.id, Department.name)
        .join(DepartmentMembership, DepartmentMembership.department_id == Department.id)
        .where(
            DepartmentMembership.organization_id == context.organization.id,
            DepartmentMembership.user_id == user_id,
        )
        .order_by(Department.name)
    ).all()
    is_self = user_id == context.user.id
    definitions = {
        **_MEMBER_DEFINITIONS,
        "scope": _MEMBER_DEFINITIONS["scope" if is_self else "scope_limited"],
    }
    return MemberSummary(
        period=_period_meta(context, period, now),
        member=MemberReportProfile(
            user_id=user_id,
            name=membership.user.name,
            job_title=membership.job_title,
            status=membership.status,
            departments=[DepartmentRef(id=row.id, name=row.name) for row in profile_departments],
        ),
        is_self=is_self,
        counts=MemberReportCounts(
            assigned=open_total,
            overdue=overdue or 0,
            blocked=by_status[TaskStatus.BLOCKED.value],
            completed=completed or 0,
            pending_update_requests=pending or 0,
        ),
        by_status=by_status,
        by_priority=by_priority,
        by_department=[
            MemberDepartmentWorkload(
                id=department_id,
                name=department_names.get(department_id, NO_DEPARTMENT),
                open=total,
            )
            for department_id, total in sorted(
                by_department.items(),
                key=lambda item: department_names.get(item[0], NO_DEPARTMENT).casefold(),
            )
        ],
        definitions=definitions,
    )
