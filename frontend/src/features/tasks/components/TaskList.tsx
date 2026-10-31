import type { ReactNode } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, type LucideIcon } from 'lucide-react'
import { AnimatePresence } from 'motion/react'

import { EmptyState, ErrorState } from '@/components/shared/StatePanels'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TaskRow } from '@/features/tasks/components/TaskRow'
import type { Page, Task } from '@/features/tasks/types'

export interface TaskGroup {
  key: string
  label: string
  tasks: Task[]
}

interface TaskListProps {
  query: {
    data: Page<Task> | undefined
    isPending: boolean
    isError: boolean
    error: Error | null
    refetch: () => unknown
    isPlaceholderData?: boolean
  }
  timezone: string
  empty: { icon: LucideIcon; title: string; description: ReactNode; action?: ReactNode }
  /** Optional grouping (Upcoming by day, My Day by overdue/today). */
  groupBy?: (tasks: Task[]) => TaskGroup[]
  onPageChange?: (page: number) => void
}

export function TaskListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading tasks">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  )
}

/** Animated list of task rows; shared by every task view. */
export function TaskRows({
  tasks,
  className,
  nested,
  ...props
}: { tasks: Task[]; className?: string; nested?: boolean } & Pick<TaskListProps, 'timezone'>) {
  return (
    <ul className={className ?? 'space-y-2'}>
      <AnimatePresence initial={false} mode="popLayout">
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} timezone={props.timezone} nested={nested} />
        ))}
      </AnimatePresence>
    </ul>
  )
}

export function TaskList({ query, empty, groupBy, onPageChange, ...rowProps }: TaskListProps) {
  if (query.isPending) return <TaskListSkeleton />
  if (query.isError) {
    return (
      <ErrorState
        title="Couldn't load tasks"
        message={query.error?.message ?? 'Please try again.'}
        onRetry={() => void query.refetch()}
      />
    )
  }

  const page = query.data!
  if (page.items.length === 0) return <EmptyState {...empty} />

  const pageCount = Math.max(1, Math.ceil(page.total / page.page_size))
  const groups = groupBy ? groupBy(page.items) : null

  return (
    <div className="space-y-4" aria-busy={query.isPlaceholderData}>
      {groups ? (
        groups.map((group) => (
          <section key={group.key} aria-labelledby={`group-${group.key}`} className="space-y-2">
            <h2
              id={`group-${group.key}`}
              className="flex items-baseline gap-2 text-sm font-semibold text-muted-foreground"
            >
              {group.label}
              <span className="text-xs font-normal tabular-nums">{group.tasks.length}</span>
            </h2>
            <TaskRows tasks={group.tasks} {...rowProps} />
          </section>
        ))
      ) : (
        <TaskRows tasks={page.items} {...rowProps} />
      )}

      {pageCount > 1 && onPageChange ? (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-2 pt-2">
          <p className="text-xs text-muted-foreground tabular-nums">
            {(page.page - 1) * page.page_size + 1}–
            {Math.min(page.page * page.page_size, page.total)} of {page.total}
          </p>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page.page <= 1}
              onClick={() => onPageChange(page.page - 1)}
            >
              <ChevronLeftIcon data-icon="inline-start" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page.page >= pageCount}
              onClick={() => onPageChange(page.page + 1)}
            >
              Next
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  )
}
