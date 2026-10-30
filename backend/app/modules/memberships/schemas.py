from typing import Literal

from pydantic import EmailStr, Field, field_validator

from app.common.schemas import ApiModel, InputModel, UtcDateTime
from app.modules.memberships.models import MembershipStatus, RequestStatus

AssignableRole = Literal["member", "team_lead", "department_manager", "admin"]


class JoinRequestCreate(InputModel):
    department_id: int | None = None
    job_title: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=500)


class RequestApprove(InputModel):
    """Approving may amend the requested department and choose the role (FR-ORG-06)."""

    department_id: int | None = None
    role_key: AssignableRole = "member"


class RequestReject(InputModel):
    note: str | None = Field(default=None, max_length=500)


class MembershipRequestRead(ApiModel):
    id: int
    organization_id: int
    organization_name: str
    user_id: int
    user_name: str
    user_email: str
    requested_department_id: int | None
    requested_department_name: str | None
    job_title: str | None
    note: str | None
    status: RequestStatus
    review_note: str | None
    reviewed_at: UtcDateTime | None
    created_at: UtcDateTime


class MyRequestRead(ApiModel):
    """The requester's own view: no reviewer identity, no other applicants' details."""

    id: int
    organization_id: int
    organization_name: str
    requested_department_name: str | None
    status: RequestStatus
    review_note: str | None
    created_at: UtcDateTime


class MemberRole(ApiModel):
    key: str
    name: str
    department_id: int | None


class MemberDepartment(ApiModel):
    id: int
    name: str


class MemberRead(ApiModel):
    membership_id: int
    user_id: int
    name: str
    email: str
    job_title: str | None
    status: MembershipStatus
    joined_at: UtcDateTime
    roles: list[MemberRole]
    departments: list[MemberDepartment]


class InvitationCreate(InputModel):
    # Omit the email for a shareable single-use link.
    email: EmailStr | None = Field(default=None, max_length=254)
    role_key: AssignableRole = "member"
    department_id: int | None = None
    expires_in_days: int = Field(default=7, ge=1, le=30)

    @field_validator("email", mode="after")
    @classmethod
    def normalize_email(cls, value: str | None) -> str | None:
        return value.strip().lower() if value else None


class InvitationRead(ApiModel):
    id: int
    email: str | None
    role_name: str
    department_name: str | None
    expires_at: UtcDateTime
    status: Literal["pending", "accepted", "revoked", "expired"]
    created_at: UtcDateTime


class InvitationCreated(InvitationRead):
    """`link` contains the secret token and is returned once, at creation only."""

    link: str


class InvitationPreview(ApiModel):
    organization_id: int
    organization_name: str
    organization_description: str | None
    department_name: str | None
    role_name: str
    email: str | None
    already_member: bool


class AuditLogRead(ApiModel):
    id: int
    action: str
    actor_name: str | None
    target_type: str
    target_id: int | None
    details: dict | None
    created_at: UtcDateTime
