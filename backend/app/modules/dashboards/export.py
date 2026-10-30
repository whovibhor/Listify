"""CSV export of the tasks behind a report (BRD Rule 14, ADR-030).

The rows come from the same scope as the report's numbers, so the file holds nothing its reader
couldn't open: one row for each task that's open now or was completed in the period.
"""

import csv
import io
from datetime import datetime, timedelta

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, aliased

from app.common import rate_limit
from app.common.time import utc_to_local
from app.core.exceptions import AppError
from app.modules.audit_logs import service as audit
from app.modules.dashboards.organization import (
    ReportRange,
    ReportScope,
    completed_in,
    department_for_report,
    department_scope,
    is_open,
    organization_scope,
)
from app.modules.organizations.models import Department
from app.modules.permissions.service import OrgContext
from app.modules.tasks.models import Task
from app.modules.users.models import User

EXPORTS_PER_USER = rate_limit.RateLimit("report-export:user", 30, timedelta(hours=1))
MAX_EXPORT_ROWS = 50_000

# Spreadsheets run a cell starting with one of these as a formula, full-width forms included.
_FORMULA_STARTS = frozenset(
    map(chr, (0x3D, 0x2B, 0x2D, 0x40, 0x09, 0x0D, 0xFF1D, 0xFF0B, 0xFF0D, 0xFF20))
)


class ExportTooLargeError(AppError):
    status_code = 422
    code = "export_too_large"


def safe_cell(value: str) -> str:
    """Keeps a cell as text. The quote mark is what spreadsheets treat as "this isn't a formula"."""
    return f"'{value}" if value.lstrip(" ")[:1] in _FORMULA_STARTS else value


def _local(value: datetime | None, period: ReportRange, *, date_only: bool = False) -> str:
    if value is None:
        return ""
    return utc_to_local(value, period.tz).strftime("%Y-%m-%d" if date_only else "%Y-%m-%d %H:%M")


def _on_time(due_at: datetime | None, completed_at: datetime | None) -> str:
    if due_at is None or completed_at is None:
        return ""
    return "Yes" if completed_at <= due_at else "No"


def _rows_in(scope: ReportScope, period: ReportRange):
    return or_(
        and_(*scope.workload, is_open()),
        and_(*scope.completions, completed_in(period)),
    )


def export_tasks(
    db: Session,
    context: OrgContext,
    department_id: int | None,
    period: ReportRange,
) -> tuple[str, str]:
    """Returns the CSV text and its filename."""
    if department_id is None:
        context.require("report.view_organization")
        scope = organization_scope(context)
    else:
        department_for_report(db, context, department_id)
        scope = department_scope(context, department_id)
    rate_limit.hit(db, EXPORTS_PER_USER, str(context.user.id))

    included = _rows_in(scope, period)
    total = db.scalar(select(func.count()).select_from(Task).where(included)) or 0
    if total > MAX_EXPORT_ROWS:
        raise ExportTooLargeError(
            f"That's {total:,} tasks, and an export holds up to {MAX_EXPORT_ROWS:,}. "
            "Export one department or choose a shorter period."
        )

    current_department = aliased(Department)
    completed_department = aliased(Department)
    assignee = aliased(User)
    rows = db.execute(
        select(
            Task.id,
            Task.title,
            current_department.name,
            Task.status,
            Task.priority,
            assignee.name,
            Task.created_at,
            Task.due_at,
            Task.due_all_day,
            Task.completed_at,
            completed_department.name,
        )
        .outerjoin(current_department, current_department.id == Task.department_id)
        .outerjoin(completed_department, completed_department.id == Task.completed_department_id)
        .outerjoin(assignee, assignee.id == Task.assigned_to)
        .where(included)
        .order_by(Task.id)
    )

    buffer = io.StringIO()
    buffer.write("﻿")  # so Excel reads the file as UTF-8
    writer = csv.writer(buffer, quoting=csv.QUOTE_ALL)
    timezone = context.organization.timezone
    writer.writerow(
        [
            "Task ID",
            "Title",
            "Department",
            "Status",
            "Priority",
            "Assignee",
            f"Created ({timezone})",
            f"Deadline ({timezone})",
            f"Completed ({timezone})",
            "Completed in department",
            "On time",
        ]
    )
    for row in rows:
        writer.writerow(
            [
                row[0],
                safe_cell(row[1]),
                safe_cell(row[2] or ""),
                row[3].value,
                row[4].value,
                safe_cell(row[5] or ""),
                _local(row[6], period),
                _local(row[7], period, date_only=row[8]),
                _local(row[9], period),
                safe_cell(row[10] or ""),
                _on_time(row[7], row[9]),
            ]
        )

    audit.record(
        db,
        organization_id=context.organization.id,
        actor_id=context.user.id,
        action="report.exported",
        target_type="department" if department_id else "organization",
        target_id=department_id or context.organization.id,
        details={"start": str(period.start), "end": str(period.end), "rows": total},
    )
    db.commit()
    return buffer.getvalue(), f"listify-tasks-{period.start}-to-{period.end}.csv"
