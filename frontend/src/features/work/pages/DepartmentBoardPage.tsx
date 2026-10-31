import { useState } from 'react'
import {
  Building2Icon,
  CalendarDaysIcon,
  ChartPieIcon,
  EyeIcon,
  EyeOffIcon,
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
import { STATUS_LABELS, type TaskStatus } from '@/features/tasks/task-meta'
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

// Off until someone asks, so the board opens on the work that's moving.
const HIDEABLE_COLUMNS: TaskStatus[] = ['blocked', 'cancelled']

const PAGE_SIZE = 25

function ColumnToggle({
  status,
  total,
  shown,
  onToggle,
}: {
  status: TaskStatus
  total: number
  shown: boolean
  onToggle: () => void
}) {
  const Icon = shown ? EyeIcon : EyeOffIcon
  return (
    <Button
      variant="outline"
      size="sm"
      aria-pressed={shown}
      aria-label={`Show ${STATUS_LABELS[status]} column, ${total} tasks`}
      onClick={onToggle}
      className={cn(shown && 'border-primary/40 bg-accent/60')}
    >
      <Icon data-icon="inline-start" />
      {STATUS_LABELS[status]}
      <span className="text-muted-foreground tabular-nums">{total}</span>
    </Button>
  )
}

export function DepartmentBoardPage() {
  const org = useOrg()
  const departmentId = Number(useParams().departmentId)
  const search = useTaskSearchParams()
  const { filters, update, openTaskId, openTask } = search
  const [params] = useSearchParams()
  const [creating, setCreating] = useState(false)
  const layout = (params.get('layout') as Layout | null) ?? 'board'
  const shared = workParams(search)
  const shownColumns = params.getAll('show') as TaskStatus[]
  // A link that asks for a status needs its column.
  const isShown = (status: TaskStatus) =>
    shownColumns.includes(status) || filters.status.includes(status)
  const hidden = HIDEABLE_COLUMNS.filter((status) => !isShown(status))
  const boardParams = { ...shared, collapsed: hidden }
  const board = useBoard(org.id, departmentId, boardParams)
  const showFinished = params.get('finished') === 'true'
  const list = useOrganizationTasks(
    org.id,
    {
      ...shared,
      // Searching still finds finished work.
      active: !showFinished && !filters.q,
      department_id: departmentId,
      sort: filters.sort,
      page: filters.page,
      page_size: PAGE_SIZE,
    },
    { enabled: layout === 'list' },
  )

  const showColumn = (status: TaskStatus) => update({ show: [...shownColumns, status] })
  const toggleColumn = (status: TaskStatus) =>
    isShown(status)
      ? update({
          show: shownColumns.filter((shown) => shown !== status),
          status: filters.status.filter((filtered) => filtered !== status),
        })
      : showColumn(status)

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
            <Button variant="outline" asChild>
              <Link to={`/org/${org.id}/departments/${departmentId}`}>
                <Building2Icon data-icon="inline-start" />
                Department
              </Link>
            </Button>
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
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Board layout" className="inline-flex w-fit rounded-lg bg-muted p-1">
            {LAYOUTS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                aria-pressed={layout === value}
                onClick={() =>
                  // The board has no status filter, so one left from the List view couldn't be undone.
                  update(value === 'board' ? { layout: null, status: null } : { layout: value })
                }
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
          {layout === 'board'
            ? HIDEABLE_COLUMNS.map((status) => (
                <ColumnToggle
                  key={status}
                  status={status}
                  total={data?.columns.find((column) => column.status === status)?.total ?? 0}
                  shown={isShown(status)}
                  onToggle={() => toggleColumn(status)}
                />
              ))
            : null}
          {layout === 'list' ? (
            <Button
              variant="outline"
              size="sm"
              aria-pressed={showFinished}
              onClick={() => update({ finished: showFinished ? null : 'true' })}
              className={cn(showFinished && 'border-primary/40 bg-accent/60')}
            >
              Show finished
            </Button>
          ) : null}
        </div>
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
          params={boardParams}
          timezone={org.timezone}
          onOpen={openTask}
          hidden={hidden}
          onShowColumn={showColumn}
          onShowOlder={() => update({ layout: 'list', status: ['completed'] })}
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
