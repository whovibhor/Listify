import { STATUS_LABELS, type TaskStatus } from '@/features/tasks/task-meta'
import type { TaskActivity, TaskVisibility } from '@/features/tasks/types'
import { VISIBILITY_LABELS } from '@/features/work/types'

const FIELD_LABELS: Record<string, string> = {
  title: 'title',
  description: 'description',
  priority: 'priority',
  due_at: 'deadline',
  due_all_day: 'deadline time',
  start_at: 'start date',
  tags: 'tags',
  estimated_minutes: 'estimate',
  actual_minutes: 'actual effort',
}

function statusLabel(value: unknown) {
  return STATUS_LABELS[value as TaskStatus] ?? String(value)
}

/** Plain-language sentence for an activity event ("changed status from X to Y"). */
export function describeActivity(activity: TaskActivity): string {
  const oldValue = activity.old_value ?? {}
  const newValue = activity.new_value ?? {}
  switch (activity.event_type) {
    case 'created':
      return 'created this task'
    case 'completed':
      return 'completed this task'
    case 'reopened':
      return 'reopened this task'
    case 'status_changed':
      return `changed status from ${statusLabel(oldValue.status)} to ${statusLabel(newValue.status)}`
    case 'archived':
      return 'archived this task'
    case 'restored':
      return 'restored this task'
    case 'assigned':
      return newValue.name ? `assigned this to ${String(newValue.name)}` : 'unassigned this task'
    case 'collaborator_added':
      return `added ${String(newValue.name)} as a collaborator`
    case 'collaborator_removed':
      return `removed ${String(oldValue.name)} as a collaborator`
    case 'moved':
      return `moved this to ${newValue.department ? String(newValue.department) : 'no department'}`
    case 'visibility_changed':
      return `changed visibility to ${VISIBILITY_LABELS[newValue.visibility as TaskVisibility]}`
    case 'subtask_added':
      return `added subtask “${String(newValue.title)}”`
    case 'subtask_deleted':
      return `deleted subtask “${String(oldValue.title)}”`
    case 'updated': {
      const fields = Object.keys(newValue)
        .filter((key) => key !== 'due_all_day' || !('due_at' in newValue))
        .map((key) => FIELD_LABELS[key] ?? key)
      return `updated ${fields.join(', ')}`
    }
    default:
      return activity.event_type.replaceAll('_', ' ')
  }
}
