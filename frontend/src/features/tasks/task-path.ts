import type { Task } from '@/features/tasks/types'

export type TaskTab = 'comments' | 'files' | 'requests' | 'activity'

/** Where a task lives: a personal task and an organization task have different addresses. */
export function taskPath(task: Pick<Task, 'id' | 'organization_id'>, tab?: TaskTab) {
  const base = task.organization_id
    ? `/org/${task.organization_id}/tasks/${task.id}`
    : `/personal/tasks/${task.id}`
  return tab ? `${base}/${tab}` : base
}
