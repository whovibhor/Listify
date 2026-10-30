import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'

import type {
  Page,
  Tag,
  TagColor,
  Task,
  TaskActivity,
  TaskDetail,
  TaskInput,
  TaskListParams,
} from '@/features/tasks/types'
import type { TaskStatus } from '@/features/tasks/task-meta'
import { api } from '@/lib/api-client'

export const taskKeys = {
  all: ['tasks'] as const,
  lists: ['tasks', 'list'] as const,
  list: (params: TaskListParams) => ['tasks', 'list', params] as const,
  organization: (id: number, params: object) =>
    ['tasks', 'list', 'organization', id, params] as const,
  board: (id: number, departmentId: number, params: object) =>
    ['tasks', 'board', id, departmentId, params] as const,
  detail: (id: number) => ['tasks', 'detail', id] as const,
  activity: (id: number) => ['tasks', 'activity', id] as const,
  tags: (organizationId?: number) => ['tags', organizationId ?? 'personal'] as const,
}

const DASHBOARD_KEY = ['dashboard'] as const

function toQuery(params: TaskListParams) {
  const search = new URLSearchParams()
  search.set('view', params.view)
  for (const status of params.status ?? []) search.append('status', status)
  for (const priority of params.priority ?? []) search.append('priority', priority)
  for (const tag of params.tag ?? []) search.append('tag', String(tag))
  if (params.overdue !== undefined) search.set('overdue', String(params.overdue))
  if (params.q) search.set('q', params.q)
  if (params.sort) search.set('sort', params.sort)
  if (params.page) search.set('page', String(params.page))
  if (params.page_size) search.set('page_size', String(params.page_size))
  return search.toString()
}

/** Everything derived from tasks (lists, details, dashboard) is refreshed after a write. */
export function invalidateTaskData(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: taskKeys.all })
  void queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY })
}

export function useTasks(params: TaskListParams) {
  return useQuery({
    queryKey: taskKeys.list(params),
    queryFn: () => api.get<Page<Task>>(`/me/tasks?${toQuery(params)}`),
    placeholderData: keepPreviousData,
  })
}

export function useTask(id: number | null) {
  return useQuery({
    queryKey: taskKeys.detail(id ?? 0),
    queryFn: () => api.get<TaskDetail>(`/tasks/${id}`),
    enabled: id !== null,
  })
}

export function useTaskActivity(id: number | null) {
  return useQuery({
    queryKey: taskKeys.activity(id ?? 0),
    queryFn: () => api.get<TaskActivity[]>(`/tasks/${id}/activity`),
    enabled: id !== null,
  })
}

/** With an organization, creates organization work; otherwise a personal task. */
export function useCreateTask(organizationId?: number | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: TaskInput & { title: string }) =>
      api.post<TaskDetail>(
        organizationId ? `/organizations/${organizationId}/tasks` : '/me/tasks',
        input,
      ),
    onSuccess: () => invalidateTaskData(queryClient),
  })
}

export function useUpdateTask(id: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: TaskInput) => api.patch<TaskDetail>(`/tasks/${id}`, input),
    onSuccess: (task) => {
      queryClient.setQueryData(taskKeys.detail(id), task)
      invalidateTaskData(queryClient)
    },
  })
}

type TaskAction = 'complete' | 'reopen' | 'archive' | 'restore'

export function useTaskAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: TaskAction }) =>
      api.post<TaskDetail>(`/tasks/${id}/${action}`),
    onSuccess: (task) => queryClient.setQueryData(taskKeys.detail(task.id), task),
    onSettled: () => invalidateTaskData(queryClient),
  })
}

/**
 * Checkbox toggle with an optimistic status change in every cached list, rolled back if the
 * server refuses (e.g. open subtasks).
 */
export function useToggleComplete() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ task }: { task: Task }) =>
      api.post<TaskDetail>(
        `/tasks/${task.id}/${task.status === 'completed' ? 'reopen' : 'complete'}`,
      ),
    onMutate: async ({ task }) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.lists })
      const snapshot = queryClient.getQueriesData<Page<Task>>({ queryKey: taskKeys.lists })
      const nextStatus: TaskStatus = task.status === 'completed' ? 'in_progress' : 'completed'
      queryClient.setQueriesData<Page<Task>>({ queryKey: taskKeys.lists }, (page) =>
        page
          ? {
              ...page,
              items: page.items.map((item) =>
                item.id === task.id ? { ...item, status: nextStatus, is_overdue: false } : item,
              ),
            }
          : page,
      )
      return { snapshot }
    },
    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.snapshot ?? []) queryClient.setQueryData(key, data)
    },
    onSuccess: (task) => queryClient.setQueryData(taskKeys.detail(task.id), task),
    onSettled: () => invalidateTaskData(queryClient),
  })
}

export function useDeleteTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/tasks/${id}`),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: taskKeys.detail(id) })
      invalidateTaskData(queryClient)
    },
  })
}

// --- Tags --------------------------------------------------------------------------------------

function tagsPath(organizationId?: number | null) {
  return organizationId ? `/organizations/${organizationId}/tags` : '/me/tags'
}

export function useTags(organizationId?: number | null) {
  return useQuery({
    queryKey: taskKeys.tags(organizationId ?? undefined),
    queryFn: () => api.get<Tag[]>(tagsPath(organizationId)),
    staleTime: 5 * 60_000,
  })
}

export function useCreateTag(organizationId?: number | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; color: TagColor }) =>
      api.post<Tag>(tagsPath(organizationId), input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: taskKeys.tags(organizationId ?? undefined) }),
  })
}

export function useDeleteTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/me/tags/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.tags() })
      invalidateTaskData(queryClient)
    },
  })
}
