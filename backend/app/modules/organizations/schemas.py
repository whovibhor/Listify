from typing import Annotated

from pydantic import AfterValidator, Field, field_validator

from app.common.schemas import ApiModel, InputModel, UtcDateTime
from app.modules.organizations.models import DepartmentStatus
from app.modules.users.schemas import validate_timezone


def _validate_website(value: str | None) -> str | None:
    if value and not value.lower().startswith(("http://", "https://")):
        raise ValueError("Enter a full URL starting with http:// or https://")
    return value or None


Website = Annotated[str | None, Field(max_length=255), AfterValidator(_validate_website)]


class DepartmentInput(InputModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    open_for_join_requests: bool = True


class DepartmentUpdate(InputModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    open_for_join_requests: bool | None = None


class DepartmentRead(ApiModel):
    id: int
    organization_id: int
    name: str
    description: str | None
    status: DepartmentStatus
    open_for_join_requests: bool
    member_count: int = 0


class OrganizationCreate(InputModel):
    name: str = Field(min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    website: Website = None
    location: str | None = Field(default=None, max_length=120)
    timezone: str | None = None
    is_discoverable: bool = False
    departments: list[DepartmentInput] = Field(default_factory=list, max_length=50)

    @field_validator("timezone")
    @classmethod
    def check_timezone(cls, value: str | None) -> str | None:
        return None if value is None else validate_timezone(value)

    @field_validator("departments")
    @classmethod
    def check_unique_departments(cls, value: list[DepartmentInput]) -> list[DepartmentInput]:
        names = [department.name.casefold() for department in value]
        if len(names) != len(set(names)):
            raise ValueError("Department names must be unique")
        return value


class OrganizationUpdate(InputModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    website: Website = None
    location: str | None = Field(default=None, max_length=120)
    timezone: str | None = None
    is_discoverable: bool | None = None
    review_required: bool | None = None

    @field_validator("timezone")
    @classmethod
    def check_timezone(cls, value: str | None) -> str | None:
        return None if value is None else validate_timezone(value)


class OrganizationRead(ApiModel):
    id: int
    name: str
    slug: str
    description: str | None
    website: str | None
    location: str | None
    timezone: str
    is_discoverable: bool
    review_required: bool
    created_at: UtcDateTime


class MyOrganization(OrganizationRead):
    """An organization plus what the current user may do there (drives navigation)."""

    role_keys: list[str]
    permissions: list[str]
    department_permissions: dict[int, list[str]]
    department_ids: list[int]


class OrganizationPublic(ApiModel):
    """The only fields a non-member may see, and only for discoverable organizations."""

    id: int
    name: str
    description: str | None
    location: str | None
    website: str | None
    my_status: str  # none | pending | member


class OrganizationJoinInfo(OrganizationPublic):
    departments: list[DepartmentRead]
