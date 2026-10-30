import type { useTaskSearchParams } from '@/features/tasks/use-task-search-params'
import type { WorkParams } from '@/features/work/api'

export const UNASSIGNED = 'none'

/** Turns the URL's filters into API parameters, shared by every organization task view. */
export function workParams({ filters }: ReturnType<typeof useTaskSearchParams>): WorkParams {
  return {
    status: filters.status,
    priority: filters.priority,
    tag: filters.tag,
    overdue: filters.overdue || undefined,
    q: filters.q || undefined,
    assignee:
      filters.assignee && filters.assignee !== UNASSIGNED ? Number(filters.assignee) : undefined,
    unassigned: filters.assignee === UNASSIGNED || undefined,
    creator: filters.creator ? Number(filters.creator) : undefined,
    due_from: filters.due_from || undefined,
    due_to: filters.due_to || undefined,
  }
}
