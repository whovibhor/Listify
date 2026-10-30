import type { ReactNode } from 'react'
import { motion } from 'motion/react'

import { PageHeader } from '@/components/shared/PageHeader'
import { useMe } from '@/features/auth/api'
import { useTasks } from '@/features/tasks/api'
import { QuickAddTask } from '@/features/tasks/components/QuickAddTask'
import { TaskDetailSheet } from '@/features/tasks/components/TaskDetailSheet'
import { TaskFilters } from '@/features/tasks/components/TaskFilters'
import { TaskList, type TaskGroup } from '@/features/tasks/components/TaskList'
import type { TaskStatus } from '@/features/tasks/task-meta'
import type { Task, TaskInput, TaskSort, TaskView } from '@/features/tasks/types'
import { useTaskSearchParams } from '@/features/tasks/use-task-search-params'
import { pageEnter } from '@/lib/motion'

const PAGE_SIZE = 25

export interface TaskViewConfig {
  view: TaskView
  title: string
  description?: ReactNode
  headerActions?: ReactNode
  quickAdd?: { defaults?: Omit<TaskInput, 'title'>; placeholder?: string } | false
  statuses: readonly TaskStatus[]
  sorts: TaskSort[]
  defaultSort: TaskSort
  showOverdueFilter?: boolean
  groupBy?: (tasks: Task[], timezone: string) => TaskGroup[]
  empty: Parameters<typeof TaskList>[0]['empty']
  /** Shown instead of `empty` when filters hide everything. */
  filteredEmptyTitle?: string
}

export function TaskViewPage(config: TaskViewConfig) {
  const { data: user } = useMe()
  const timezone = user?.timezone ?? 'UTC'
  const search = useTaskSearchParams()
  const { filters, openTaskId, openTask, update, activeFilterCount, clearFilters } = search

  const query = useTasks({
    view: config.view,
    status: filters.status,
    priority: filters.priority,
    tag: filters.tag,
    overdue: filters.overdue || undefined,
    q: filters.q || undefined,
    sort: filters.sort,
    page: filters.page,
    page_size: PAGE_SIZE,
  })

  const empty =
    activeFilterCount > 0
      ? {
          icon: config.empty.icon,
          title: config.filteredEmptyTitle ?? 'No tasks match these filters',
          description: 'Try removing a filter or searching for something else.',
          action: (
            <button
              type="button"
              onClick={clearFilters}
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Clear filters
            </button>
          ),
        }
      : config.empty

  return (
    <motion.div {...pageEnter} className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title={config.title}
        description={config.description}
        actions={config.headerActions}
      />
      {config.quickAdd ? (
        <QuickAddTask
          defaults={config.quickAdd.defaults}
          placeholder={config.quickAdd.placeholder}
        />
      ) : null}
      <TaskFilters
        search={search}
        statuses={config.statuses}
        sorts={config.sorts}
        defaultSort={config.defaultSort}
        showOverdue={config.showOverdueFilter}
      />
      <TaskList
        query={query}
        timezone={timezone}
        onOpen={openTask}
        selectedId={openTaskId}
        empty={empty}
        groupBy={
          config.groupBy && !filters.sort ? (tasks) => config.groupBy!(tasks, timezone) : undefined
        }
        onPageChange={(page) => update({ page })}
      />
      <TaskDetailSheet taskId={openTaskId} timezone={timezone} onClose={() => openTask(null)} />
    </motion.div>
  )
}
