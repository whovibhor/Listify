import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'

import type {
  DepartmentDashboard,
  DepartmentSummary,
  DepartmentWorkload,
  MemberActivity,
  MemberSummary,
  OrganizationDashboard,
} from '@/features/reports/types'
import type { Page } from '@/features/tasks/types'
import { api, saveFile } from '@/lib/api-client'

export interface ReportRange {
  start?: string
  end?: string
}

// Under 'dashboard', so that changing a task refreshes these with the personal dashboard.
export const reportKeys = {
  organization: (orgId: number) => ['dashboard', 'organization', orgId] as const,
}

export function useOrganizationDashboard(
  orgId: number,
  range: ReportRange,
  { enabled = true } = {},
) {
  return useQuery({
    queryKey: [...reportKeys.organization(orgId), 'overview', range],
    queryFn: () =>
      api.get<OrganizationDashboard>(`/organizations/${orgId}/dashboard`, { query: { ...range } }),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useDepartmentReports(orgId: number, range: ReportRange, { enabled = true } = {}) {
  return useQuery({
    queryKey: [...reportKeys.organization(orgId), 'departments', range],
    queryFn: () =>
      api.get<DepartmentWorkload[]>(`/organizations/${orgId}/reports/departments`, {
        query: { ...range },
      }),
    enabled,
  })
}

export function useDepartmentDashboard(orgId: number, departmentId: number, range: ReportRange) {
  return useQuery({
    queryKey: [...reportKeys.organization(orgId), 'department', departmentId, range],
    queryFn: () =>
      api.get<DepartmentDashboard>(
        `/organizations/${orgId}/departments/${departmentId}/dashboard`,
        {
          query: { ...range },
        },
      ),
    placeholderData: keepPreviousData,
  })
}

export function useDepartmentSummary(orgId: number, departmentId: number) {
  return useQuery({
    queryKey: [...reportKeys.organization(orgId), 'department-summary', departmentId],
    queryFn: () =>
      api.get<DepartmentSummary>(`/organizations/${orgId}/departments/${departmentId}/summary`),
  })
}

export function useMemberActivity(orgId: number, range: ReportRange, page: number) {
  return useQuery({
    queryKey: [...reportKeys.organization(orgId), 'members', range, page],
    queryFn: () =>
      api.get<Page<MemberActivity>>(`/organizations/${orgId}/reports/members`, {
        query: { ...range, page, page_size: 25 },
      }),
    placeholderData: keepPreviousData,
  })
}

export function useMemberSummary(
  orgId: number,
  userId: number,
  range: ReportRange,
  { enabled = true } = {},
) {
  return useQuery({
    queryKey: [...reportKeys.organization(orgId), 'member', userId, range],
    queryFn: () =>
      api.get<MemberSummary>(`/organizations/${orgId}/members/${userId}/summary`, {
        query: { ...range },
      }),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useExportReport(orgId: number) {
  return useMutation({
    mutationFn: (input: ReportRange & { department_id?: number }) =>
      saveFile(`/organizations/${orgId}/reports/tasks.csv`, { ...input }),
  })
}
