"""Central organization authorization (ADR-010). Every org-scoped route resolves an OrgContext.

The organization always comes from the URL plus a verified active membership, never from a
request body. No active membership → 404, so outsiders can't confirm an organization exists.
"""

from dataclasses import dataclass, field
from typing import Annotated, Any

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ForbiddenError, NotFoundError
from app.db.session import get_db
from app.modules.auth.dependencies import CurrentAuth
from app.modules.memberships.models import (
    DepartmentMembership,
    MembershipStatus,
    OrganizationMembership,
)
from app.modules.organizations.models import Organization, OrganizationStatus
from app.modules.users.models import User


@dataclass
class OrgContext:
    """What the current user may do in one organization, resolved once per request."""

    user: User
    organization: Organization
    membership: OrganizationMembership
    department_ids: set[int] = field(default_factory=set)
    org_permissions: set[str] = field(default_factory=set)
    department_permissions: dict[int, set[str]] = field(default_factory=dict)
    db: Session | None = None
    # Worked out by `policies.visible_tasks` the first time it's needed.
    shared_task_ids: dict[Any, list[int] | None] = field(default_factory=dict)

    @property
    def role_keys(self) -> list[str]:
        return sorted({assignment.role.key for assignment in self.membership.roles})

    def can(self, permission: str, department_id: int | None = None) -> bool:
        """True when granted organization-wide, or for this specific department."""
        if permission in self.org_permissions:
            return True
        return department_id is not None and permission in self.department_permissions.get(
            department_id, set()
        )

    def can_anywhere(self, permission: str) -> bool:
        return permission in self.org_permissions or any(
            permission in granted for granted in self.department_permissions.values()
        )

    def departments_with(self, permission: str) -> set[int]:
        return {
            department_id
            for department_id, granted in self.department_permissions.items()
            if permission in granted
        }

    def require(self, permission: str, department_id: int | None = None) -> None:
        if not self.can(permission, department_id):
            raise ForbiddenError("You don't have permission to do that.")

    def require_anywhere(self, permission: str) -> None:
        if not self.can_anywhere(permission):
            raise ForbiddenError("You don't have permission to do that.")


def load_context(db: Session, user: User, organization_id: int) -> OrgContext:
    membership = db.scalar(
        select(OrganizationMembership).where(
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.user_id == user.id,
            OrganizationMembership.status == MembershipStatus.ACTIVE,
        )
    )
    organization = db.get(Organization, organization_id) if membership else None
    if (
        membership is None
        or organization is None
        or organization.status != OrganizationStatus.ACTIVE
    ):
        raise NotFoundError("Organization not found.")

    context = OrgContext(user=user, organization=organization, membership=membership, db=db)
    context.department_ids = set(
        db.scalars(
            select(DepartmentMembership.department_id).where(
                DepartmentMembership.organization_id == organization_id,
                DepartmentMembership.user_id == user.id,
            )
        )
    )
    for assignment in membership.roles:
        keys = {permission.key for permission in assignment.role.permissions}
        if assignment.department_id is None:
            context.org_permissions |= keys
        else:
            context.department_permissions.setdefault(assignment.department_id, set()).update(keys)
    return context


def get_org_context(organization_id: int, auth: CurrentAuth, db: Session = Depends(get_db)):
    return load_context(db, auth.user, organization_id)


OrgCtx = Annotated[OrgContext, Depends(get_org_context)]
