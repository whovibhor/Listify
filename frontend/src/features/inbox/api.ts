import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'

import type { InboxFilter, InboxSummary, InboxNotification } from '@/features/inbox/types'
import type { Page } from '@/features/tasks/types'
import { api } from '@/lib/api-client'

export const inboxKeys = {
  all: ['inbox'] as const,
  list: (filter: InboxFilter, page: number) => ['inbox', 'list', filter, page] as const,
  summary: ['inbox', 'summary'] as const,
}

const SUMMARY_REFRESH_MS = 60_000

export function useInbox(filter: InboxFilter, page: number) {
  return useQuery({
    queryKey: inboxKeys.list(filter, page),
    queryFn: () =>
      api.get<Page<InboxNotification>>('/inbox', { query: { filter, page, page_size: 25 } }),
    placeholderData: keepPreviousData,
  })
}

/** Drives the badges. Refreshes by itself, so new items show up without a reload. */
export function useInboxSummary() {
  return useQuery({
    queryKey: inboxKeys.summary,
    queryFn: () => api.get<InboxSummary>('/inbox/summary'),
    refetchInterval: SUMMARY_REFRESH_MS,
  })
}

function refreshInbox(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: inboxKeys.all })
}

export function useMarkRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<void>(`/notifications/${id}/read`),
    onSuccess: () => refreshInbox(queryClient),
  })
}

export function useMarkAllRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<void>('/notifications/read-all'),
    onSuccess: () => refreshInbox(queryClient),
  })
}
