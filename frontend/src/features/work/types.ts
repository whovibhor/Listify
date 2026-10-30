import type { TaskStatus } from '@/features/tasks/task-meta'
import type { Task, TaskVisibility } from '@/features/tasks/types'

export type WorkView = 'team' | 'my_work' | 'collaborating' | 'archived'

export interface BoardColumn {
  status: TaskStatus
  total: number
  items: Task[]
}

export interface Board {
  department: { id: number; name: string }
  archived: boolean
  review_required: boolean
  can_create: boolean
  columns: BoardColumn[]
}

export const VISIBILITY_LABELS: Record<TaskVisibility, string> = {
  private: 'Private',
  department: 'Department',
  selected: 'Selected people',
  organization: 'Organization',
}

// The admin note is the explicit policy the PRD asks members to be told about (ADR-027).
export const VISIBILITY_HINTS: Record<TaskVisibility, string> = {
  private: 'Only the people on this task. Organization admins can still open it.',
  department: 'Everyone in this department.',
  selected: 'The people on this task, plus those you pick. Organization admins can still open it.',
  organization: 'Everyone in the organization.',
}
