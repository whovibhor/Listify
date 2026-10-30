from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from app.common.pagination import Page, PageParams, page_params
from app.db.base import utc_now
from app.modules.auth.dependencies import CurrentAuth, DbSession
from app.modules.dashboards import export, organization, service
from app.modules.dashboards.schemas import (
    DepartmentDashboard,
    DepartmentWorkload,
    MemberActivity,
    MemberSummary,
    OrganizationDashboard,
    Period,
    PersonalDashboard,
)
from app.modules.permissions.service import OrgCtx

router = APIRouter(tags=["dashboards"])

ReportDate = Annotated[date | None, Query()]


@router.get("/me/dashboard", response_model=PersonalDashboard)
def my_dashboard(auth: CurrentAuth, db: DbSession, period: Period = "7d") -> PersonalDashboard:
    return service.personal_dashboard(db, auth.user, period, utc_now())


@router.get("/organizations/{organization_id}/dashboard", response_model=OrganizationDashboard)
def organization_dashboard(
    context: OrgCtx, db: DbSession, start: ReportDate = None, end: ReportDate = None
) -> OrganizationDashboard:
    now = utc_now()
    period = organization.report_range(context, start, end, now)
    return organization.organization_dashboard(db, context, period, now)


@router.get(
    "/organizations/{organization_id}/reports/departments",
    response_model=list[DepartmentWorkload],
)
def department_reports(
    context: OrgCtx, db: DbSession, start: ReportDate = None, end: ReportDate = None
) -> list[DepartmentWorkload]:
    now = utc_now()
    period = organization.report_range(context, start, end, now)
    return organization.reportable_departments(db, context, period, now)


@router.get(
    "/organizations/{organization_id}/departments/{department_id}/dashboard",
    response_model=DepartmentDashboard,
)
def department_dashboard(
    department_id: int,
    context: OrgCtx,
    db: DbSession,
    start: ReportDate = None,
    end: ReportDate = None,
) -> DepartmentDashboard:
    now = utc_now()
    period = organization.report_range(context, start, end, now)
    return organization.department_dashboard(db, context, department_id, period, now)


@router.get("/organizations/{organization_id}/reports/members", response_model=Page[MemberActivity])
def member_activity(
    context: OrgCtx,
    db: DbSession,
    paging: PageParams = Depends(page_params),
    start: ReportDate = None,
    end: ReportDate = None,
) -> Page[MemberActivity]:
    now = utc_now()
    period = organization.report_range(context, start, end, now)
    items, total = organization.member_activity(
        db, context, period, now, offset=paging.offset, limit=paging.page_size
    )
    return Page(items=items, page=paging.page, page_size=paging.page_size, total=total)


@router.get(
    "/organizations/{organization_id}/members/{user_id}/summary",
    response_model=MemberSummary,
)
def member_summary(
    user_id: int,
    context: OrgCtx,
    db: DbSession,
    start: ReportDate = None,
    end: ReportDate = None,
) -> MemberSummary:
    now = utc_now()
    period = organization.report_range(context, start, end, now)
    return organization.member_summary(db, context, user_id, period, now)


@router.get("/organizations/{organization_id}/reports/tasks.csv")
def export_tasks(
    context: OrgCtx,
    db: DbSession,
    department_id: int | None = None,
    start: ReportDate = None,
    end: ReportDate = None,
) -> Response:
    period = organization.report_range(context, start, end, utc_now())
    content, filename = export.export_tasks(db, context, department_id, period)
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
