import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api-client'

export type DashboardPeriod = '7d' | '30d' | '90d'

export interface PersonalDashboard {
  period: DashboardPeriod
  period_start: string
  generated_at: string
  timezone: string
  counts: {
    due_today: number
    overdue: number
    upcoming_7d: number
    open: number
    completed_in_period: number
    created_in_period: number
  }
  on_time: { eligible: number; on_time: number; rate: number | null }
  trend: { date: string; completed: number; created: number }[]
  open_by_priority: Record<string, number>
  open_by_status: Record<string, number>
  definitions: Record<string, string>
}

export function usePersonalDashboard(period: DashboardPeriod) {
  return useQuery({
    queryKey: ['dashboard', 'personal', period],
    queryFn: () => api.get<PersonalDashboard>(`/me/dashboard?period=${period}`),
    placeholderData: keepPreviousData,
  })
}
