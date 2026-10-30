import { useState } from 'react'
import {
  CalendarDaysIcon,
  ChartPieIcon,
  KanbanIcon,
  ListIcon,
  ListTodoIcon,
  PlusIcon,
  type LucideIcon,
} from 'lucide-react'
import { motion } from 'motion/react'
import { Link, useParams, useSearchParams } from 'react-router'

import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState, ErrorState } from '@/components/shared/StatePanels'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { can } from '@/features/organizations/permissions'
import { useOrg } from '@/features/organizations/use-current-org'
import { TaskDetailSheet } from '@/features/tasks/components/TaskDetailSheet'
import { useTaskSearchParams } from '@/features/tasks/use-task-search-params'
import { useBoard, useOrganizationTasks } from '@/features/work/api'
import { BoardView } from '@/features/work/components/BoardView'
import { CreateTaskDialog } from '@/features/work/components/CreateTaskDialog'
import { WorkCalendar } from '@/features/work/components/WorkCalendar'
import { WorkFilters } from '@/features/work/components/WorkFilters'
import { WorkTable } from '@/features/work/components/WorkTable'
import { workParams } from '@/features/work/work-params'
import { ApiError } from '@/lib/api-client'
import { pageEnter } from '@/lib/motion'
import { cn } from '@/lib/utils'

type Layout = 'board' | 'list' | 'calendar'

const LAYOUTS: { value: Layout; label: string; icon: LucideIcon }[] = [
  { value: 'board', label: 'Board', icon: KanbanIcon },
  { value: 'list', label: 'List', icon: ListIcon },
  { value: 'calendar', label: 'Calendar', icon: CalendarDaysIcon },
]

const PAGE_SIZE = 25

export function DepartmentBoardPage() {
  const org = useOrg()
  const departmentId = Number(useParams().departmentId)
  const search = useTaskSearchParams()
  const { filters, update, openTaskId, openTask } = search
  const [params] = useSearchParams()
  const [creating, setCreating] = useState(false)
  const layout = (params.get('layout') as Layout | null) ?? 'board'
  const shared = workParams(search)
  const board = useBoard(org.id, departmentId, shared)
  const list = useOrganizationTasks(
    org.id,
    {
      ...shared,
      department_id: departmentId,
      sort: filters.sort,
      page: filters.page,
      page_size: PAGE_SIZE,
    },
    { enabled: layout === 'list' },
  )

  // Departments the viewer can't open look like they don't exist (BR-006).
  if (board.error instanceof ApiError && board.error.status === 404) return <NotFoundPage />
  const data = board.data

  return (
    <motion.div {...pageEnter} className="space-y-4">
      <PageHeader
        title={data?.department.name ?? 'Department'}
        description={
          data?.archived ? 'This department is archived. Tasks are read-only history.' : undefined
        }
        actions={
          <>
            {can(org, 'report.view_department', departmentId) ? (
              <Button variant="outline" asChild>
                <Link to={`/org/${org.id}/reports/departments/${departmentId}`}>
                  <ChartPieIcon data-icon="inline-start" />
                  Report
                </Link>
              </Button>
            ) : null}
            {data?.can_create ? (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon data-icon="inline-start" />
                New task
              </Button>
            ) : null}
          </>
        }
      />
      <div className="flex flex-col gap-3">
        <nav aria-label="Board layout" className="inline-flex w-fit rounded-lg bg-muted p-1">
          {LAYOUTS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={layout === value}
              onClick={() => update({ layout: value === 'board' ? null : value })}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-(--duration-fast) outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                layout === value
                  ? 'bg-card text-foreground shadow-card'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon aria-hidden className="size-4" />
              {label}
            </button>
          ))}
        </nav>
        <WorkFilters
          organizationId={org.id}
          search={search}
          departmentId={departmentId}
          showSort={layout === 'list'}
          showDueRange={layout !== 'calendar'}
        />
      </div>

      {board.isPending ? (
        <Skeleton className="h-96 w-full rounded-2xl" />
      ) : board.isError ? (
        <ErrorState message={board.error.message} onRetry={() => void board.refetch()} />
      ) : layout === 'board' ? (
        <BoardView
          organizationId={org.id}
          board={data!}
          params={shared}
          timezone={org.timezone}
          onOpen={openTask}
        />
      ) : layout === 'calendar' ? (
        <WorkCalendar
          organizationId={org.id}
          params={{ ...shared, department_id: departmentId }}
          timezone={org.timezone}
          month={params.get('month')}
          onMonthChange={(month) => update({ month })}
          onOpen={openTask}
        />
      ) : list.isPending ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : list.isError ? (
        <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          icon={ListTodoIcon}
          title="No tasks here"
          description="Change the filters, or create the first task."
        />
      ) : (
        <WorkTable
          page={list.data}
          timezone={org.timezone}
          sort={filters.sort ?? 'due'}
          onSort={(sort) => update({ sort: sort === 'due' ? null : sort })}
          onOpen={openTask}
          onPageChange={(page) => update({ page })}
        />
      )}

      {creating ? (
        <CreateTaskDialog
          departmentId={departmentId}
          onClose={() => setCreating(false)}
          onCreated={openTask}
        />
      ) : null}
      <TaskDetailSheet taskId={openTaskId} timezone={org.timezone} onClose={() => openTask(null)} />
    </motion.div>
  )
}
