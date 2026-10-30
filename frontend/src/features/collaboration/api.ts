import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import type {
  PendingUpdateRequest,
  TaskAttachment,
  TaskComment,
  UpdateRequest,
} from '@/features/collaboration/types'
import { inboxKeys } from '@/features/inbox/api'
import { invalidateTaskData, taskKeys } from '@/features/tasks/api'
import type { TaskStatus } from '@/features/tasks/task-meta'
import { api } from '@/lib/api-client'

export const collaborationKeys = {
  comments: (taskId: number) => ['tasks', 'comments', taskId] as const,
  attachments: (taskId: number) => ['tasks', 'attachments', taskId] as const,
  updates: (taskId: number) => ['tasks', 'update-requests', taskId] as const,
  myUpdates: ['tasks', 'my-update-requests'] as const,
}

function refreshTask(queryClient: QueryClient, taskId: number) {
  void queryClient.invalidateQueries({ queryKey: taskKeys.activity(taskId) })
}

// --- Comments ----------------------------------------------------------------------------------

export function useComments(taskId: number) {
  return useQuery({
    queryKey: collaborationKeys.comments(taskId),
    queryFn: () => api.get<TaskComment[]>(`/tasks/${taskId}/comments`),
  })
}

function useCommentChange<Input, Output>(taskId: number, run: (input: Input) => Promise<Output>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: collaborationKeys.comments(taskId) })
      refreshTask(queryClient, taskId)
    },
  })
}

export function useAddComment(taskId: number) {
  return useCommentChange(taskId, (input: { body: string; mention_user_ids: number[] }) =>
    api.post<TaskComment>(`/tasks/${taskId}/comments`, input),
  )
}

export function useEditComment(taskId: number) {
  return useCommentChange(taskId, ({ id, body }: { id: number; body: string }) =>
    api.patch<TaskComment>(`/comments/${id}`, { body }),
  )
}

export function useDeleteComment(taskId: number) {
  return useCommentChange(taskId, (id: number) => api.delete<void>(`/comments/${id}`))
}

// --- Attachments -------------------------------------------------------------------------------

export function useAttachments(taskId: number) {
  return useQuery({
    queryKey: collaborationKeys.attachments(taskId),
    queryFn: () => api.get<TaskAttachment[]>(`/tasks/${taskId}/attachments`),
  })
}

export function attachmentDownloadUrl(id: number) {
  return `/api/v1/attachments/${id}/download`
}

function useAttachmentChange<Input, Output>(
  taskId: number,
  run: (input: Input) => Promise<Output>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: collaborationKeys.attachments(taskId) })
      refreshTask(queryClient, taskId)
    },
  })
}

export function useUploadAttachment(taskId: number) {
  return useAttachmentChange(taskId, (file: File) =>
    api.upload<TaskAttachment>(`/tasks/${taskId}/attachments`, file, {
      query: { filename: file.name },
    }),
  )
}

export function useDeleteAttachment(taskId: number) {
  return useAttachmentChange(taskId, (id: number) => api.delete<void>(`/attachments/${id}`))
}

// --- Update requests ---------------------------------------------------------------------------

export function useUpdateRequests(taskId: number) {
  return useQuery({
    queryKey: collaborationKeys.updates(taskId),
    queryFn: () => api.get<UpdateRequest[]>(`/tasks/${taskId}/update-requests`),
  })
}

export function useMyUpdateRequests({ enabled = true } = {}) {
  return useQuery({
    queryKey: collaborationKeys.myUpdates,
    queryFn: () => api.get<PendingUpdateRequest[]>('/me/update-requests'),
    enabled,
  })
}

/** A response can also change the task's status, so everything derived from tasks refreshes. */
function useUpdateRequestChange<Input>(run: (input: Input) => Promise<UpdateRequest>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      invalidateTaskData(queryClient)
      void queryClient.invalidateQueries({ queryKey: inboxKeys.all })
    },
  })
}

export function useRequestUpdate(taskId: number) {
  return useUpdateRequestChange(
    (input: { recipient_id: number; message: string; respond_by: string | null }) =>
      api.post<UpdateRequest>(`/tasks/${taskId}/update-requests`, input),
  )
}

export function useRespondToUpdate() {
  return useUpdateRequestChange(
    ({ id, ...input }: { id: number; response_note: string; status: TaskStatus | null }) =>
      api.post<UpdateRequest>(`/update-requests/${id}/respond`, input),
  )
}

export function useCancelUpdate() {
  return useUpdateRequestChange((id: number) =>
    api.post<UpdateRequest>(`/update-requests/${id}/cancel`),
  )
}
