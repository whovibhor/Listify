"""The permission model in code (PRD §5.4, ADR-011). The roles migration seeds the same data, and
`tests/test_permissions.py` fails if the database and this catalog ever disagree."""

OWNER = "owner"
ADMIN = "admin"
DEPARTMENT_MANAGER = "department_manager"
TEAM_LEAD = "team_lead"
MEMBER = "member"

PERMISSIONS: dict[str, str] = {
    "task.create": "Create tasks within permitted scope",
    "task.view_own": "View tasks assigned to or created by the user",
    "task.view_department": "View eligible tasks on an authorized department board",
    "task.view_organization": "View tasks shared with the whole organization",
    "task.view_all": "View every task in the organization, whatever its visibility",
    "task.assign": "Assign tasks to eligible members",
    "task.update": "Change task fields allowed by policy",
    "task.delete": "Delete or archive tasks within permitted scope",
    "task.comment": "Add comments to tasks the user can access",
    "task.manage_collaborators": "Add or remove task collaborators",
    "task.request_update": "Request an update from an assignee or collaborator",
    "member.view": "View the member directory within permitted scope",
    "member.approve": "Approve or reject membership requests",
    "member.manage": "Invite, suspend, remove or transfer members",
    "department.create": "Create departments",
    "department.update": "Update or archive departments",
    "role.assign": "Assign approved roles to members",
    "report.view_personal": "View own personal analytics",
    "report.view_department": "View department analytics",
    "report.view_organization": "View organization analytics",
    "organization.settings.update": "Change organization profile and policy settings",
}

_MEMBER_PERMISSIONS = {
    "task.create",
    "task.view_own",
    "task.view_department",
    "task.view_organization",
    "task.update",
    "task.comment",
    "member.view",
    "report.view_personal",
}
_TEAM_LEAD_PERMISSIONS = _MEMBER_PERMISSIONS | {
    "task.assign",
    "task.manage_collaborators",
    "task.request_update",
    "report.view_department",
}
_MANAGER_PERMISSIONS = _TEAM_LEAD_PERMISSIONS | {
    "task.delete",
    "member.approve",
    "department.update",
}

# key → (name, scope_type, description, permissions)
ROLES: dict[str, tuple[str, str, str, frozenset[str]]] = {
    OWNER: (
        "Owner",
        "organization",
        "Full control of the organization",
        frozenset(PERMISSIONS),
    ),
    ADMIN: (
        "Admin",
        "organization",
        "Runs day-to-day administration",
        frozenset(PERMISSIONS),
    ),
    DEPARTMENT_MANAGER: (
        "Department Manager",
        "department",
        "Leads a department's work and people",
        frozenset(_MANAGER_PERMISSIONS),
    ),
    TEAM_LEAD: (
        "Team Lead",
        "department",
        "Coordinates tasks and follow-ups in a department",
        frozenset(_TEAM_LEAD_PERMISSIONS),
    ),
    MEMBER: (
        "Member",
        "organization",
        "Works on tasks and collaborates",
        frozenset(_MEMBER_PERMISSIONS),
    ),
}

# Owner is only ever granted by creating the organization or by transferring ownership.
ASSIGNABLE_ROLES = (MEMBER, TEAM_LEAD, DEPARTMENT_MANAGER, ADMIN)
