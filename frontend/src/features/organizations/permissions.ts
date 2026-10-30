import type { MyOrganization } from '@/features/organizations/types'

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

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  department_manager: 'Department Manager',
  team_lead: 'Team Lead',
  member: 'Member',
}

/** The most senior role, for compact labels such as the workspace switcher. */
export function primaryRoleLabel(org: MyOrganization) {
  const key = Object.keys(ROLE_LABELS).find((role) => org.role_keys.includes(role))
  return key ? ROLE_LABELS[key] : 'Member'
}
