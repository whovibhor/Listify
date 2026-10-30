import type { TaskStatus } from '@/features/tasks/task-meta'
import type { Person } from '@/features/tasks/types'

export interface TaskComment {
  id: number
  task_id: number
  author: Person
  /** Null once deleted. */
  body: string | null
  deleted: boolean
  edited: boolean
  created_at: string
  can_edit: boolean
  can_delete: boolean
}

export interface TaskAttachment {
  id: number
  task_id: number
  filename: string
  content_type: string
  size_bytes: number
  uploaded_by: Person
  created_at: string
  can_delete: boolean
}

export interface UpdateRequest {
  id: number
  task_id: number
  requester: Person
  recipient: Person
  message: string
  respond_by: string | null
  status: 'pending' | 'responded' | 'cancelled'
  response_note: string | null
  responded_at: string | null
  created_at: string
  can_respond: boolean
  can_cancel: boolean
}

export interface PendingUpdateRequest extends UpdateRequest {
  task_title: string
  organization_id: number
  allowed_statuses: TaskStatus[]
}

// Mirrors `collaboration/attachments.py`. The server decides; this only gives faster feedback.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const ATTACHMENT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.docx,.xlsx,.pptx,.zip'
