import { useInboxSummary } from '@/features/inbox/api'
import { useMyOrganizations } from '@/features/organizations/api'
import { useActiveOrganization } from '@/features/organizations/use-current-org'

/** The inbox of the workspace the shell is showing, for its links and badges. */
export function useWorkspaceInbox() {
  const active = useActiveOrganization()
  const { data: organizations } = useMyOrganizations()
  // Held back until we know which workspace this is, so a badge never shows the wrong one's count.
  const { data } = useInboxSummary(active?.id ?? 'personal', {
    enabled: organizations !== undefined,
  })
  return {
    path: active ? `/org/${active.id}/inbox` : '/inbox',
    waiting: (data?.unread ?? 0) + (data?.pending_update_requests ?? 0),
    otherWorkspaces: data?.other_workspaces ?? 0,
  }
}
