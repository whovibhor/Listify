export type InboxFilter = 'all' | 'unread' | 'assignments' | 'update_requests'

/** An organization's ID, or Personal. */
export type InboxWorkspace = number | 'personal'

export interface InboxNotification {
  id: number
  type: string
  read: boolean
  created_at: string
  /** False for a task the person can no longer see: its details are withheld by the server. */
  accessible: boolean
  actor_name: string | null
  organization_id: number | null
  task: { id: number; title: string; organization_id: number } | null
  data: { organization_name?: string; department?: string }
}

export interface InboxSummary {
  unread: number
  pending_update_requests: number
  /** What's waiting in the person's other workspaces. */
  other_workspaces: number
}

/** "Mia assigned you", then the task title, or the whole sentence for membership changes. */
export function describeNotification(item: InboxNotification): string {
  const actor = item.actor_name ?? 'Someone'
  const organization = item.data.organization_name ?? 'the organization'
  const department = item.data.department ?? 'a department'
  const texts: Record<string, string> = {
    assigned: `${actor} assigned you a task`,
    collaborator_added: `${actor} added you as a collaborator`,
    comment: `${actor} commented`,
    mention: `${actor} mentioned you`,
    update_requested: `${actor} asked you for an update`,
    update_responded: `${actor} responded to your update request`,
    update_cancelled: `${actor} cancelled an update request`,
    membership_approved: `Your request to join ${organization} was approved`,
    membership_rejected: `Your request to join ${organization} was declined`,
    role_changed: `Your roles in ${organization} changed`,
    membership_suspended: `Your membership of ${organization} was suspended`,
    membership_reactivated: `Your membership of ${organization} was reactivated`,
    membership_removed: `You were removed from ${organization}`,
    member_transferred: `You were moved to ${department} in ${organization}`,
    department_added: `You were added to ${department} in ${organization}`,
    department_removed: `You were taken out of ${department} in ${organization}`,
    ownership_received: `You’re now the Owner of ${organization}`,
  }
  return texts[item.type] ?? 'Something changed'
}
