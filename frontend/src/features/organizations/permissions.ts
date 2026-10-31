import type { Member, MemberRole, MyOrganization } from '@/features/organizations/types'

/**
 * UI hints only: these decide what to show. The server enforces every rule again (ADR-010).
 */
export function can(org: MyOrganization, permission: string, departmentId?: number | null) {
  if (org.permissions.includes(permission)) return true
  if (departmentId == null) return false
  return org.department_permissions[String(departmentId)]?.includes(permission) ?? false
}

export function canAnywhere(org: MyOrganization, permission: string) {
  return (
    org.permissions.includes(permission) ||
    Object.values(org.department_permissions).some((granted) => granted.includes(permission))
  )
}

/** Owners and Admins: they work across every department, not inside one. */
export function isOrganizationAdmin(org: MyOrganization) {
  return can(org, 'department.create') || can(org, 'member.manage')
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  department_manager: 'Department Manager',
  team_lead: 'Team Lead',
  member: 'Member',
}

/** "Team Lead · Sales" for a department role, "Admin" for an organization-wide one. */
export function roleLabel(role: MemberRole, departments: Member['departments']) {
  const department = departments.find((candidate) => candidate.id === role.department_id)
  return department ? `${role.name} · ${department.name}` : role.name
}

/** The most senior role, for compact labels such as the sidebar. */
export function primaryRoleLabel(org: MyOrganization) {
  const key = Object.keys(ROLE_LABELS).find((role) => org.role_keys.includes(role))
  return key ? ROLE_LABELS[key] : 'Member'
}
