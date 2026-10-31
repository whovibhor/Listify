import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'

import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from '@/features/tasks/task-meta'
import type { TaskSort } from '@/features/tasks/types'

const SORTS: TaskSort[] = [
  'due',
  '-due',
  'priority',
  '-priority',
  'created',
  '-created',
  'title',
  'completed',
]

export interface TaskFilterState {
  status: TaskStatus[]
  priority: TaskPriority[]
  tag: number[]
  q: string
  sort: TaskSort | undefined
  page: number
  overdue: boolean
  // Organization views only.
  assignee: string
  creator: string
  due_from: string
  due_to: string
}

/** URL keys beyond the filters: the open task, and each organization page's own settings. */
type ExtraParam =
  'task' | 'layout' | 'month' | 'view' | 'department' | 'flagged' | 'archived' | 'finished' | 'show'

/**
 * Filters, sort, page and the open task live in the URL: shareable, back-button friendly and
 * preserved across reloads (PRD: preserve filters and navigation state).
 */
export function useTaskSearchParams() {
  const [params, setParams] = useSearchParams()

  const filters = useMemo<TaskFilterState>(() => {
    const sort = params.get('sort') as TaskSort | null
    return {
      status: params
        .getAll('status')
        .filter((s): s is TaskStatus => TASK_STATUSES.includes(s as TaskStatus)),
      priority: params
        .getAll('priority')
        .filter((p): p is TaskPriority => TASK_PRIORITIES.includes(p as TaskPriority)),
      tag: params.getAll('tag').map(Number).filter(Number.isInteger),
      q: params.get('q') ?? '',
      sort: sort && SORTS.includes(sort) ? sort : undefined,
      page: Math.max(1, Number(params.get('page')) || 1),
      overdue: params.get('overdue') === 'true',
      assignee: params.get('assignee') ?? '',
      creator: params.get('creator') ?? '',
      due_from: params.get('due_from') ?? '',
      due_to: params.get('due_to') ?? '',
    }
  }, [params])

  const openTaskId = Number(params.get('task')) || null

  const update = useCallback(
    (
      changes: Partial<
        Record<keyof TaskFilterState | ExtraParam, string | string[] | number | null>
      >,
    ) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          for (const [key, value] of Object.entries(changes)) {
            next.delete(key)
            const values = Array.isArray(value)
              ? value
              : value === null || value === ''
                ? []
                : [String(value)]
            for (const item of values) next.append(key, item)
          }
          // Any filter change returns to the first page.
          if (!('page' in changes) && !('task' in changes)) next.delete('page')
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const openTask = useCallback((id: number | null) => update({ task: id }), [update])
  const clearFilters = useCallback(
    () =>
      update({
        status: null,
        priority: null,
        tag: null,
        q: null,
        overdue: null,
        assignee: null,
        creator: null,
        due_from: null,
        due_to: null,
      }),
    [update],
  )
  const activeFilterCount =
    filters.status.length +
    filters.priority.length +
    filters.tag.length +
    (filters.q ? 1 : 0) +
    (filters.overdue ? 1 : 0) +
    [filters.assignee, filters.creator, filters.due_from, filters.due_to].filter(Boolean).length

  return { filters, update, openTaskId, openTask, clearFilters, activeFilterCount }
}
