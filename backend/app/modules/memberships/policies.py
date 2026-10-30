"""Who may change which member (ADR-026). Enforcement and the UI's buttons both read this table."""

from app.modules.memberships.models import MembershipStatus, OrganizationMembership
from app.modules.memberships.schemas import MemberAction
from app.modules.permissions import catalog
from app.modules.permissions.service import OrgContext

# Making someone Owner has no permission of its own: `allowed_actions` limits it to the Owner.
ACTION_PERMISSIONS: dict[MemberAction, str] = {
    "change_roles": "role.assign",
    "suspend": "member.manage",
    "reactivate": "member.manage",
    "remove": "member.manage",
    "transfer": "member.manage",
    "add_department": "member.manage",
    "leave_department": "member.manage",
    "make_owner": "organization.settings.update",
}

DEPARTMENT_ACTIONS: tuple[MemberAction, ...] = ("transfer", "add_department", "leave_department")


def is_owner(membership: OrganizationMembership) -> bool:
    return any(assignment.role.key == catalog.OWNER for assignment in membership.roles)


def allowed_actions(context: OrgContext, target: OrganizationMembership) -> list[MemberAction]:
    """What the current user may do to `target` right now, for one member of the directory."""
    if target.status == MembershipStatus.REMOVED:
        return []
    if target.status == MembershipStatus.SUSPENDED:
        return ["reactivate", "remove"] if context.can("member.manage") else []

    is_self = target.user_id == context.user.id
    target_is_owner = is_owner(target)
    actions: list[MemberAction] = []
    # Only the Owner touches the Owner's membership, and then only their own departments.
    if context.can("member.manage") and (is_self or not target_is_owner):
        actions.extend(DEPARTMENT_ACTIONS)
    # Nobody can lock themselves out. The Owner's role changes only by transferring ownership.
    if not is_self and not target_is_owner:
        if context.can("role.assign"):
            actions.append("change_roles")
        if context.can("member.manage"):
            actions.extend(("suspend", "remove"))
        if is_owner(context.membership):
            actions.append("make_owner")
    return actions
