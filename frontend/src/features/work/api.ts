import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { invalidateTaskData, taskKeys } from '@/features/tasks/api'
import type { TaskPriority, TaskStatus } from '@/features/tasks/task-meta'
import type { Page, Task, TaskDetail, TaskSort } from '@/features/tasks/types'
import type { Board, WorkView } from '@/features/work/types'
import { api } from '@/lib/api-client'

export interface WorkParams {
  view?: WorkView
  department_id?: number
  assignee?: number
  unassigned?: boolean
  creator?: number
  status?: TaskStatus[]
  priority?: TaskPriority[]
  tag?: number[]
  overdue?: boolean
  due_from?: string
  due_to?: string
  needs_reassignment?: boolean
  q?: string
  sort?: TaskSort
  page?: number
  page_size?: number
}

function toQuery(params: WorkParams) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === false || value === '') continue
    for (const item of Array.isArray(value) ? value : [value]) search.append(key, String(item))
  }
  return search.toString()
}

export function useOrganizationTasks(
  organizationId: number,
  params: WorkParams,
  { enabled = true } = {},
) {
  return useQuery({
    queryKey: taskKeys.organization(organizationId, params),
    queryFn: () => api.get<Page<Task>>(`/organizations/${organizationId}/tasks?${toQuery(params)}`),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useBoard(organizationId: number, departmentId: number, params: WorkParams) {
  return useQuery({
    queryKey: taskKeys.board(organizationId, departmentId, params),
    queryFn: () =>
      api.get<Board>(
        `/organizations/${organizationId}/departments/${departmentId}/board?${toQuery(params)}`,
      ),
    placeholderData: keepPreviousData,
  })
}

/** Dragging a card moves it at once and puts it back if the server refuses. */
export function useMoveOnBoard(organizationId: number, departmentId: number, params: WorkParams) {
  const queryClient = useQueryClient()
  const key = taskKeys.board(organizationId, departmentId, params)
  return useMutation({
    mutationFn: ({ task, status }: { task: Task; status: TaskStatus }) =>
      api.patch<TaskDetail>(`/tasks/${task.id}`, { status }),
    onMutate: async ({ task, status }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const snapshot = queryClient.getQueryData<Board>(key)
      queryClient.setQueryData<Board>(key, (board) =>
        board
          ? {
              ...board,
              columns: board.columns.map((column) => {
                const items = column.items.filter((item) => item.id !== task.id)
                if (column.status === status) items.unshift({ ...task, status })
                return {
                  ...column,
                  items,
                  total: column.total + items.length - column.items.length,
                }
              }),
            }
          : board,
      )
      return { snapshot }
    },
    onError: (_error, _vars, context) => queryClient.setQueryData(key, context?.snapshot),
    onSettled: () => invalidateTaskData(queryClient),
  })
}

export function useAddCollaborator(taskId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (userId: number) =>
      api.post<TaskDetail>(`/tasks/${taskId}/collaborators`, { user_id: userId }),
    onSuccess: (task) => {
      queryClient.setQueryData(taskKeys.detail(taskId), task)
      invalidateTaskData(queryClient)
    },
  })
}

export function useRemoveCollaborator(taskId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (userId: number) =>
      api.delete<TaskDetail>(`/tasks/${taskId}/collaborators/${userId}`),
    onSuccess: (task) => {
      queryClient.setQueryData(taskKeys.detail(taskId), task)
      invalidateTaskData(queryClient)
    },
  })
}
