from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.common.pagination import Page, PageParams, page_params
from app.modules.auth.dependencies import CurrentAuth, DbSession
from app.modules.organizations import service
from app.modules.organizations.schemas import (
    DepartmentInput,
    DepartmentRead,
    DepartmentUpdate,
    MyOrganization,
    OrganizationCreate,
    OrganizationJoinInfo,
    OrganizationPublic,
    OrganizationUpdate,
)
from app.modules.permissions.service import OrgCtx, load_context

router = APIRouter(tags=["organizations"])


@router.get("/me/organizations", response_model=list[MyOrganization])
def my_organizations(auth: CurrentAuth, db: DbSession) -> list[MyOrganization]:
    return service.list_my_organizations(db, auth.user)


@router.post("/organizations", response_model=MyOrganization, status_code=status.HTTP_201_CREATED)
def create_organization(
    payload: OrganizationCreate, auth: CurrentAuth, db: DbSession
) -> MyOrganization:
    organization = service.create_organization(db, auth.user, payload)
    return service.to_my_organization(load_context(db, auth.user, organization.id))


@router.get("/organizations/discover", response_model=Page[OrganizationPublic])
def discover_organizations(
    q: Annotated[str, Query(min_length=2, max_length=100)],
    auth: CurrentAuth,
    db: DbSession,
    paging: PageParams = Depends(page_params),
) -> Page[OrganizationPublic]:
    items, total = service.discover_organizations(
        db, auth.user, q.strip(), offset=paging.offset, limit=paging.page_size
    )
    return Page[OrganizationPublic](
        items=items, page=paging.page, page_size=paging.page_size, total=total
    )


@router.get("/organizations/{organization_id}/join-info", response_model=OrganizationJoinInfo)
def join_info(organization_id: int, auth: CurrentAuth, db: DbSession) -> OrganizationJoinInfo:
    """Public profile and open departments of a discoverable organization; 404 for private ones."""
    organization = service.get_joinable_organization(db, organization_id)
    return OrganizationJoinInfo(
        id=organization.id,
        name=organization.name,
        description=organization.description,
        location=organization.location,
        website=organization.website,
        my_status=service.join_status(db, auth.user, organization.id),
        departments=[
            DepartmentRead.model_validate(department)
            for department in service.open_departments(db, organization.id)
        ],
    )


@router.get("/organizations/{organization_id}", response_model=MyOrganization)
def read_organization(context: OrgCtx) -> MyOrganization:
    return service.to_my_organization(context)


@router.patch("/organizations/{organization_id}", response_model=MyOrganization)
def update_organization(
    payload: OrganizationUpdate, context: OrgCtx, db: DbSession
) -> MyOrganization:
    context.require("organization.settings.update")
    service.update_organization(db, context, payload)
    return service.to_my_organization(context)


@router.get("/organizations/{organization_id}/departments", response_model=list[DepartmentRead])
def list_departments(
    context: OrgCtx, db: DbSession, include_archived: bool = False
) -> list[DepartmentRead]:
    return service.list_departments(db, context, include_archived=include_archived)


@router.post(
    "/organizations/{organization_id}/departments",
    response_model=DepartmentRead,
    status_code=status.HTTP_201_CREATED,
)
def create_department(payload: DepartmentInput, context: OrgCtx, db: DbSession) -> DepartmentRead:
    context.require("department.create")
    return DepartmentRead.model_validate(service.create_department(db, context, payload))


@router.patch(
    "/organizations/{organization_id}/departments/{department_id}",
    response_model=DepartmentRead,
)
def update_department(
    department_id: int, payload: DepartmentUpdate, context: OrgCtx, db: DbSession
) -> DepartmentRead:
    department = service.get_department(db, context.organization.id, department_id)
    context.require("department.update", department.id)
    return DepartmentRead.model_validate(
        service.update_department(db, context, department, payload)
    )


@router.post(
    "/organizations/{organization_id}/departments/{department_id}/archive",
    response_model=DepartmentRead,
)
def archive_department(department_id: int, context: OrgCtx, db: DbSession) -> DepartmentRead:
    department = service.get_department(db, context.organization.id, department_id)
    context.require("department.update", department.id)
    return DepartmentRead.model_validate(
        service.set_department_archived(db, context, department, True)
    )


@router.post(
    "/organizations/{organization_id}/departments/{department_id}/restore",
    response_model=DepartmentRead,
)
def restore_department(department_id: int, context: OrgCtx, db: DbSession) -> DepartmentRead:
    department = service.get_department(db, context.organization.id, department_id)
    context.require("department.update", department.id)
    return DepartmentRead.model_validate(
        service.set_department_archived(db, context, department, False)
    )
