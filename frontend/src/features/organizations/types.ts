export interface Organization {
  id: number
  name: string
  slug: string
  description: string | null
  website: string | null
  location: string | null
  timezone: string
  is_discoverable: boolean
  review_required: boolean
  created_at: string
}

/** An organization plus what the signed-in user may do there. */
export interface MyOrganization extends Organization {
  role_keys: string[]
  permissions: string[]
  department_permissions: Record<string, string[]>
  department_ids: number[]
}

export interface Department {
  id: number
  organization_id: number
  name: string
  description: string | null
  status: 'active' | 'archived'
  open_for_join_requests: boolean
  member_count: number
}

export interface OrganizationPublic {
  id: number
  name: string
  description: string | null
  location: string | null
  website: string | null
  my_status: 'none' | 'pending' | 'member'
}

export interface OrganizationJoinInfo extends OrganizationPublic {
  departments: Department[]
}

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export interface MyJoinRequest {
  id: number
  organization_id: number
  organization_name: string
  requested_department_name: string | null
  status: RequestStatus
  review_note: string | null
  created_at: string
}

export interface MembershipRequest {
  id: number
  organization_id: number
  organization_name: string
  user_id: number
  user_name: string
  user_email: string
  requested_department_id: number | null
  requested_department_name: string | null
  job_title: string | null
  note: string | null
  status: RequestStatus
  review_note: string | null
  reviewed_at: string | null
  created_at: string
}

export interface Member {
  membership_id: number
  user_id: number
  name: string
  email: string
  job_title: string | null
  status: 'active' | 'suspended' | 'removed'
  joined_at: string
  roles: { key: string; name: string; department_id: number | null }[]
  departments: { id: number; name: string }[]
}

export type AssignableRole = 'member' | 'team_lead' | 'department_manager' | 'admin'

export const ROLE_OPTIONS: { value: AssignableRole; label: string; description: string }[] = [
  { value: 'member', label: 'Member', description: 'Works on tasks and collaborates' },
  { value: 'team_lead', label: 'Team Lead', description: 'Coordinates a department’s tasks' },
  {
    value: 'department_manager',
    label: 'Department Manager',
    description: 'Leads a department’s work and people',
  },
  { value: 'admin', label: 'Admin', description: 'Runs day-to-day administration' },
]

export interface Invitation {
  id: number
  email: string | null
  role_name: string
  department_name: string | null
  expires_at: string
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  created_at: string
}

export interface InvitationCreated extends Invitation {
  link: string
}

export interface InvitationPreview {
  organization_id: number
  organization_name: string
  organization_description: string | null
  department_name: string | null
  role_name: string
  email: string | null
  already_member: boolean
}

export interface AuditEntry {
  id: number
  action: string
  actor_name: string | null
  target_type: string
  target_id: number | null
  details: Record<string, unknown> | null
  created_at: string
}
