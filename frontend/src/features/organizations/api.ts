import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'

import type {
  AssignableRole,
  AuditEntry,
  Department,
  ImpactAction,
  Invitation,
  InvitationCreated,
  InvitationPreview,
  Member,
  MemberImpact,
  MembershipRequest,
  MyJoinRequest,
  MyOrganization,
  OrganizationJoinInfo,
  OrganizationPublic,
  RequestStatus,
} from '@/features/organizations/types'
import { reportKeys } from '@/features/reports/api'
import type { Page } from '@/features/tasks/types'
import { api } from '@/lib/api-client'
import { MY_ORGANIZATIONS_QUERY_KEY } from '@/lib/query-keys'

export const orgKeys = {
  all: ['organizations'] as const,
  mine: MY_ORGANIZATIONS_QUERY_KEY,
  myRequests: ['organizations', 'my-requests'] as const,
  discover: (q: string) => ['organizations', 'discover', q] as const,
  joinInfo: (id: number) => ['organizations', 'join-info', id] as const,
  scoped: (id: number) => ['organizations', id] as const,
  departments: (id: number, archived: boolean) =>
    ['organizations', id, 'departments', archived] as const,
  members: (id: number, params: object) => ['organizations', id, 'members', params] as const,
  // Outside the organization's key on purpose: a preview must not refetch once it's been acted on.
  impact: (id: number, membershipId: number, params: object) =>
    ['member-impact', id, membershipId, params] as const,
  requests: (id: number, status?: RequestStatus) =>
    ['organizations', id, 'requests', status] as const,
  invitations: (id: number) => ['organizations', id, 'invitations'] as const,
  audit: (id: number, page: number) => ['organizations', id, 'audit', page] as const,
}

function refreshOrganization(queryClient: QueryClient, id: number) {
  void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(id) })
  void queryClient.invalidateQueries({ queryKey: orgKeys.mine })
  void queryClient.invalidateQueries({ queryKey: reportKeys.organization(id) })
}

// --- My organizations --------------------------------------------------------------------------

export function useMyOrganizations() {
  return useQuery({
    queryKey: orgKeys.mine,
    queryFn: () => api.get<MyOrganization[]>('/me/organizations'),
    staleTime: 60_000,
  })
}

export function useCreateOrganization() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      name: string
      description?: string
      website?: string
      location?: string
      timezone?: string
      is_discoverable: boolean
      departments: { name: string }[]
    }) => api.post<MyOrganization>('/organizations', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orgKeys.mine }),
  })
}

export function useUpdateOrganization(id: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<MyOrganization>) =>
      api.patch<MyOrganization>(`/organizations/${id}`, input),
    onSuccess: () => refreshOrganization(queryClient, id),
  })
}

// --- Discovery and joining ---------------------------------------------------------------------

export function useDiscoverOrganizations(q: string) {
  return useQuery({
    queryKey: orgKeys.discover(q),
    queryFn: () =>
      api.get<Page<OrganizationPublic>>('/organizations/discover', { query: { q, page_size: 20 } }),
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
  })
}

export function useJoinInfo(id: number | null) {
  return useQuery({
    queryKey: orgKeys.joinInfo(id ?? 0),
    queryFn: () => api.get<OrganizationJoinInfo>(`/organizations/${id}/join-info`),
    enabled: id !== null,
  })
}

export function useMyJoinRequests() {
  return useQuery({
    queryKey: orgKeys.myRequests,
    queryFn: () => api.get<MyJoinRequest[]>('/me/membership-requests'),
  })
}

export function useRequestToJoin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      organizationId,
      ...body
    }: {
      organizationId: number
      department_id: number | null
      job_title?: string
      note?: string
    }) => api.post<MyJoinRequest>(`/organizations/${organizationId}/membership-requests`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orgKeys.all }),
  })
}

export function useCancelJoinRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<void>(`/me/membership-requests/${id}/cancel`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orgKeys.all }),
  })
}

// --- Departments -------------------------------------------------------------------------------

export function useDepartments(organizationId: number, { archived = false, enabled = true } = {}) {
  return useQuery({
    enabled,
    queryKey: orgKeys.departments(organizationId, archived),
    queryFn: () =>
      api.get<Department[]>(`/organizations/${organizationId}/departments`, {
        query: { include_archived: archived || undefined },
      }),
  })
}

export function useSaveDepartment(organizationId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      ...input
    }: {
      id?: number
      name: string
      description: string | null
      open_for_join_requests: boolean
    }) =>
      id
        ? api.patch<Department>(`/organizations/${organizationId}/departments/${id}`, input)
        : api.post<Department>(`/organizations/${organizationId}/departments`, input),
    onSuccess: () => refreshOrganization(queryClient, organizationId),
  })
}

export function useSetDepartmentArchived(organizationId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) =>
      api.post<Department>(
        `/organizations/${organizationId}/departments/${id}/${archived ? 'archive' : 'restore'}`,
      ),
    onSuccess: () => refreshOrganization(queryClient, organizationId),
  })
}

// --- Members -----------------------------------------------------------------------------------

export function useMembers(
  organizationId: number,
  params: {
    q?: string
    department_id?: number
    status?: 'active' | 'suspended'
    page?: number
    page_size?: number
  } = {},
  { enabled = true } = {},
) {
  return useQuery({
    queryKey: orgKeys.members(organizationId, params),
    queryFn: () =>
      api.get<Page<Member>>(`/organizations/${organizationId}/members`, { query: params }),
    placeholderData: keepPreviousData,
    enabled,
  })
}

function useMemberChange<Input, Output>(
  organizationId: number,
  mutationFn: (input: Input) => Promise<Output>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => refreshOrganization(queryClient, organizationId),
  })
}

export function useMemberImpact(
  organizationId: number,
  membershipId: number,
  params: { action: ImpactAction; from_department_id?: number; to_department_id?: number },
  { enabled = true } = {},
) {
  return useQuery({
    queryKey: orgKeys.impact(organizationId, membershipId, params),
    queryFn: () =>
      api.get<MemberImpact>(`/organizations/${organizationId}/members/${membershipId}/impact`, {
        query: params,
      }),
    enabled,
    gcTime: 0,
  })
}

export function useChangeMemberRoles(organizationId: number, membershipId: number) {
  return useMemberChange(
    organizationId,
    (input: {
      organization_role: 'member' | 'admin'
      department_roles: { department_id: number; role_key: 'team_lead' | 'department_manager' }[]
    }) =>
      api.patch<Member>(`/organizations/${organizationId}/members/${membershipId}/roles`, input),
  )
}

/** The changes that go through an impact preview. */
export function useConfirmMemberChange(
  organizationId: number,
  membershipId: number,
  action: ImpactAction,
) {
  const member = `/organizations/${organizationId}/members/${membershipId}`
  return useMemberChange(
    organizationId,
    (input: { reason: string | null; from_department_id?: number; to_department_id: number }) => {
      if (action === 'suspend') return api.post(`${member}/suspend`, { reason: input.reason })
      if (action === 'remove') return api.post(`${member}/remove`, { reason: input.reason })
      if (action === 'transfer') {
        return api.post(`${member}/transfer`, {
          from_department_id: input.from_department_id,
          to_department_id: input.to_department_id,
        })
      }
      return api.delete(`${member}/departments/${input.from_department_id}`)
    },
  )
}

export function useReactivateMember(organizationId: number, membershipId: number) {
  return useMemberChange(organizationId, () =>
    api.post<Member>(`/organizations/${organizationId}/members/${membershipId}/reactivate`),
  )
}

export function useAddMemberDepartment(organizationId: number, membershipId: number) {
  return useMemberChange(organizationId, (departmentId: number) =>
    api.post<Member>(`/organizations/${organizationId}/members/${membershipId}/departments`, {
      department_id: departmentId,
    }),
  )
}

export function useTransferOwnership(organizationId: number) {
  return useMemberChange(organizationId, (input: { membership_id: number; password: string }) =>
    api.post<void>(`/organizations/${organizationId}/ownership-transfer`, input),
  )
}

// --- Requests (approver side) ------------------------------------------------------------------

export function useMembershipRequests(
  organizationId: number,
  status: RequestStatus | undefined,
  { enabled = true } = {},
) {
  return useQuery({
    queryKey: orgKeys.requests(organizationId, status),
    queryFn: () =>
      api.get<Page<MembershipRequest>>(`/organizations/${organizationId}/membership-requests`, {
        query: { status, page_size: 100 },
      }),
    enabled,
  })
}

export function useApproveRequest(organizationId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: number
      department_id: number | null
      role_key: AssignableRole
    }) =>
      api.post<MembershipRequest>(
        `/organizations/${organizationId}/membership-requests/${id}/approve`,
        body,
      ),
    onSuccess: () => refreshOrganization(queryClient, organizationId),
  })
}

export function useRejectRequest(organizationId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, note }: { id: number; note?: string }) =>
      api.post<MembershipRequest>(
        `/organizations/${organizationId}/membership-requests/${id}/reject`,
        { note: note || null },
      ),
    onSuccess: () => refreshOrganization(queryClient, organizationId),
  })
}

// --- Invitations -------------------------------------------------------------------------------

export function useInvitations(organizationId: number) {
  return useQuery({
    queryKey: orgKeys.invitations(organizationId),
    queryFn: () => api.get<Invitation[]>(`/organizations/${organizationId}/invitations`),
  })
}

export function useCreateInvitation(organizationId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      email: string | null
      role_key: AssignableRole
      department_id: number | null
      expires_in_days: number
    }) => api.post<InvitationCreated>(`/organizations/${organizationId}/invitations`, input),
    onSuccess: () => refreshOrganization(queryClient, organizationId),
  })
}

export function useRevokeInvitation(organizationId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.delete<void>(`/organizations/${organizationId}/invitations/${id}`),
    onSuccess: () => refreshOrganization(queryClient, organizationId),
  })
}

export function useInvitationPreview(token: string) {
  return useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api.get<InvitationPreview>(`/invitations/${encodeURIComponent(token)}`),
  })
}

export function useAcceptInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (token: string) =>
      api.post<{ organization_id: number }>(`/invitations/${encodeURIComponent(token)}/accept`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orgKeys.all }),
  })
}

// --- Audit log ---------------------------------------------------------------------------------

export function useAuditLog(organizationId: number, page: number) {
  return useQuery({
    queryKey: orgKeys.audit(organizationId, page),
    queryFn: () =>
      api.get<Page<AuditEntry>>(`/organizations/${organizationId}/audit-logs`, {
        query: { page, page_size: 25 },
      }),
    placeholderData: keepPreviousData,
  })
}
