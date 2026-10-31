import type { TaskDetail } from '@/features/tasks/types'

/** Who may do what is per action, so people see only the fields they can actually change. */
export function canEditTask(task: TaskDetail) {
  if (task.archived_at !== null) return false
  if (task.organization_id === null) return true
  // A subtask's people and visibility come from its parent, so only its details can change.
  if (task.parent_task_id !== null) return task.actions.includes('edit')
  return ['edit', 'move', 'assign', 'manage_collaborators', 'change_visibility'].some((action) =>
    task.actions.includes(action),
  )
}
