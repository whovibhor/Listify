import type { TaskPriority, TaskStatus } from '@/features/tasks/task-meta'

export const TAG_COLORS = [
  'gray',
  'violet',
  'blue',
  'teal',
  'green',
  'amber',
  'orange',
  'red',
  'pink',
] as const
export type TagColor = (typeof TAG_COLORS)[number]

export type TaskVisibility = 'private' | 'department' | 'selected' | 'organization'

export interface Person {
  id: number
  name: string
}

export interface Tag {
  id: number
  name: string
  color: TagColor
}

export interface Task {
  id: number
  parent_task_id: number | null
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  start_at: string | null
  due_at: string | null
  due_all_day: boolean
  is_overdue: boolean
  completed_at: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
  estimated_minutes: number | null
  actual_minutes: number | null
  tags: Tag[]
  subtask_count: number
  subtasks_completed: number
  // Organization tasks only; empty or null on personal tasks.
  organization_id: number | null
  visibility: TaskVisibility
  department: { id: number; name: string } | null
  assignee: Person | null
  creator: Person | null
  collaborators: Person[]
  needs_reassignment: boolean
  /** Statuses the signed-in user may move this task to. The server checks again. */
  allowed_statuses: TaskStatus[]
  actions: string[]
}

export interface TaskDetail extends Task {
  subtasks: Task[]
  visible_to: Person[]
}

export interface TaskActivity {
  id: number
  event_type: string
  actor_id: number | null
  actor_name: string | null
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  created_at: string
}

export interface Page<T> {
  items: T[]
  page: number
  page_size: number
  total: number
}

export type TaskView = 'my_day' | 'all' | 'upcoming' | 'completed' | 'done_today' | 'archived'
export type TaskSort =
  'due' | '-due' | 'priority' | '-priority' | 'created' | '-created' | 'title' | 'completed'

export interface TaskListParams {
  view: TaskView
  status?: TaskStatus[]
  priority?: TaskPriority[]
  tag?: number[]
  overdue?: boolean
  q?: string
  sort?: TaskSort
  page?: number
  page_size?: number
}

/** Dates are local (YYYY-MM-DD / HH:mm) in the user's profile timezone. */
export interface TaskInput {
  title?: string
  description?: string | null
  priority?: TaskPriority
  status?: TaskStatus
  start_date?: string | null
  due_date?: string | null
  due_time?: string | null
  tag_ids?: number[]
  parent_task_id?: number
  estimated_minutes?: number | null
  // Organization tasks only.
  department_id?: number | null
  assigned_to?: number | null
  collaborator_ids?: number[]
  visibility?: TaskVisibility
  visible_to?: number[]
}
