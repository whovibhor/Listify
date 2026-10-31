import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'

import type {
  InboxFilter,
  InboxNotification,
  InboxSummary,
  InboxWorkspace,
} from '@/features/inbox/types'
import type { Page } from '@/features/tasks/types'
import { api } from '@/lib/api-client'

export const inboxKeys = {
  all: ['inbox'] as const,
  list: (workspace: InboxWorkspace, filter: InboxFilter, page: number) =>
    ['inbox', 'list', workspace, filter, page] as const,
  summary: (workspace: InboxWorkspace) => ['inbox', 'summary', workspace] as const,
}

const SUMMARY_REFRESH_MS = 60_000

export function useInbox(workspace: InboxWorkspace, filter: InboxFilter, page: number) {
  return useQuery({
    queryKey: inboxKeys.list(workspace, filter, page),
    queryFn: () =>
      api.get<Page<InboxNotification>>('/inbox', {
        query: { workspace, filter, page, page_size: 25 },
      }),
    placeholderData: keepPreviousData,
  })
}

/** Drives the badges. Refreshes by itself, so new items show up without a reload. */
export function useInboxSummary(workspace: InboxWorkspace, { enabled = true } = {}) {
  return useQuery({
    queryKey: inboxKeys.summary(workspace),
    queryFn: () => api.get<InboxSummary>('/inbox/summary', { query: { workspace } }),
    refetchInterval: SUMMARY_REFRESH_MS,
    enabled,
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

export function useMarkAllRead(workspace: InboxWorkspace) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api.post<void>('/notifications/read-all', undefined, { query: { workspace } }),
    onSuccess: () => refreshInbox(queryClient),
  })
}
