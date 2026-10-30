import type { ReactNode } from 'react'
import {
  AlarmClockIcon,
  ArchiveIcon,
  CalendarDaysIcon,
  CalendarIcon,
  CalendarOffIcon,
  CalendarRangeIcon,
  FlameIcon,
  ListTodoIcon,
  SunIcon,
  SunriseIcon,
  type LucideIcon,
} from 'lucide-react'
import { motion } from 'motion/react'
import { Link, NavLink, useSearchParams } from 'react-router'

import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState, ErrorState } from '@/components/shared/StatePanels'
import { useMe } from '@/features/auth/api'
import { usePersonalDashboard } from '@/features/dashboards/api'
import { TaskViewPage } from '@/features/personal-tasks/components/TaskViewPage'
import { TaskSection, type SectionTone } from '@/features/personal-tasks/components/TaskSection'
import { WHEN_ORDER, groupByWhen, type WhenBucket } from '@/features/personal-tasks/grouping'
import { useTasks } from '@/features/tasks/api'
import { QuickAddTask } from '@/features/tasks/components/QuickAddTask'
import { TaskDetailSheet } from '@/features/tasks/components/TaskDetailSheet'
import { TaskFilters } from '@/features/tasks/components/TaskFilters'
import { TaskList, TaskListSkeleton } from '@/features/tasks/components/TaskList'
import { useTaskSearchParams } from '@/features/tasks/use-task-search-params'
import { pageEnter } from '@/lib/motion'
import { cn } from '@/lib/utils'

const GROUPED_PAGE_SIZE = 100

const BUCKETS: Record<WhenBucket, { title: string; icon: LucideIcon; tone: SectionTone }> = {
  overdue: { title: 'Overdue', icon: AlarmClockIcon, tone: 'danger' },
  today: { title: 'Today', icon: SunIcon, tone: 'primary' },
  tomorrow: { title: 'Tomorrow', icon: SunriseIcon, tone: 'info' },
  week: { title: 'This week', icon: CalendarDaysIcon, tone: 'info' },
  later: { title: 'Later', icon: CalendarRangeIcon, tone: 'neutral' },
  none: { title: 'No deadline', icon: CalendarOffIcon, tone: 'neutral' },
}

function ActiveArchivedSwitch({ archived }: { archived: boolean }) {
  const tabClass = (active: boolean) =>
    cn(
      'rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-(--duration-fast) outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
      active
        ? 'bg-card text-foreground shadow-card'
        : 'text-muted-foreground hover:text-foreground',
    )
  return (
    <nav aria-label="Task list" className="inline-flex rounded-lg bg-muted p-1">
      <NavLink
        to="/personal/tasks"
        end
        aria-current={archived ? undefined : 'page'}
        className={tabClass(!archived)}
      >
        Active
      </NavLink>
      <NavLink
        to="/personal/tasks?show=archived"
        aria-current={archived ? 'page' : undefined}
        className={tabClass(archived)}
      >
        Archived
      </NavLink>
    </nav>
  )
}

function SummaryChip({
  icon: Icon,
  label,
  value,
  to,
  tone = 'default',
}: {
  icon: LucideIcon
  label: string
  value: ReactNode
  to: string
  tone?: 'default' | 'danger' | 'warning'
}) {
  return (
    <Link
      to={to}
      className={cn(
        'flex min-w-0 items-center gap-3 rounded-xl bg-card px-3 py-2.5 shadow-card outline-none',
        'transition-shadow duration-(--duration-fast) hover:shadow-raised focus-visible:ring-3 focus-visible:ring-ring/50',
      )}
    >
      <span
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-lg',
          tone === 'danger'
            ? 'bg-destructive/10 text-destructive'
            : tone === 'warning'
              ? 'bg-warning/15 text-warning-foreground dark:text-warning'
              : 'bg-accent text-accent-foreground',
        )}
      >
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-xl leading-tight font-semibold">{value}</span>
        <span className="block truncate text-xs text-muted-foreground">{label}</span>
      </span>
    </Link>
  )
}

function ActiveTasks() {
  const { data: user } = useMe()
  const timezone = user?.timezone ?? 'UTC'
  const search = useTaskSearchParams()
  const { filters, openTaskId, openTask, update, activeFilterCount, clearFilters } = search
  const { data: dashboard } = usePersonalDashboard('7d')
  // Planner grouping needs the whole set; an explicit sort switches to a flat, paged list.
  const grouped = !filters.sort

  const query = useTasks({
    view: 'all',
    status: filters.status,
    priority: filters.priority,
    tag: filters.tag,
    overdue: filters.overdue || undefined,
    q: filters.q || undefined,
    sort: filters.sort,
    page: grouped ? 1 : filters.page,
    page_size: grouped ? GROUPED_PAGE_SIZE : 25,
  })

  const highPriority = dashboard
    ? dashboard.open_by_priority.urgent + dashboard.open_by_priority.high
    : null
  const rowProps = { timezone, onOpen: openTask, selectedId: openTaskId }
  const empty =
    activeFilterCount > 0
      ? {
          icon: ListTodoIcon,
          title: 'No tasks match these filters',
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
      : {
          icon: ListTodoIcon,
          title: 'No open tasks',
          description:
            'Add your first task above. Press Enter to save it, then click it to add details.',
        }

  return (
    <motion.div {...pageEnter} className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="My Tasks"
        description="Everything on your plate, planned by when it's due."
        actions={<ActiveArchivedSwitch archived={false} />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryChip
          icon={ListTodoIcon}
          label="Open tasks"
          value={dashboard?.counts.open ?? '–'}
          to="/personal/tasks"
        />
        <SummaryChip
          icon={AlarmClockIcon}
          label="Overdue"
          value={dashboard?.counts.overdue ?? '–'}
          to="/personal/tasks?overdue=true"
          tone={dashboard?.counts.overdue ? 'danger' : 'default'}
        />
        <SummaryChip
          icon={CalendarIcon}
          label="Due today"
          value={dashboard?.counts.due_today ?? '–'}
          to="/personal/my-day"
        />
        <SummaryChip
          icon={FlameIcon}
          label="High & urgent"
          value={highPriority ?? '–'}
          to="/personal/tasks?priority=urgent&priority=high"
          tone={highPriority ? 'warning' : 'default'}
        />
      </div>

      <QuickAddTask />
      <TaskFilters
        search={search}
        statuses={['not_started', 'in_progress', 'blocked']}
        sorts={['due', '-due', 'priority', '-created', 'created', 'title']}
        defaultSort="due"
      />

      {grouped ? (
        query.isPending ? (
          <TaskListSkeleton />
        ) : query.isError ? (
          <ErrorState
            title="Couldn't load tasks"
            message={query.error.message}
            onRetry={() => void query.refetch()}
          />
        ) : query.data.items.length === 0 ? (
          <EmptyState {...empty} />
        ) : (
          <div className="space-y-4">
            {(() => {
              const buckets = groupByWhen(query.data.items, timezone)
              return WHEN_ORDER.filter((key) => buckets[key].length > 0).map((key) => (
                <TaskSection
                  key={key}
                  title={BUCKETS[key].title}
                  icon={BUCKETS[key].icon}
                  tone={BUCKETS[key].tone}
                  tasks={buckets[key]}
                  defaultOpen={key !== 'later' || buckets[key].length <= 8}
                  {...rowProps}
                />
              ))
            })()}
            {query.data.total > query.data.items.length ? (
              <p className="text-center text-xs text-muted-foreground">
                Showing the first {query.data.items.length} of {query.data.total} tasks. Narrow it
                down with filters, or pick a sort order to page through everything.
              </p>
            ) : null}
          </div>
        )
      ) : (
        <TaskList
          query={query}
          empty={empty}
          onPageChange={(page) => update({ page })}
          {...rowProps}
        />
      )}

      <TaskDetailSheet taskId={openTaskId} timezone={timezone} onClose={() => openTask(null)} />
    </motion.div>
  )
}

export function MyTasksPage() {
  const [params] = useSearchParams()
  if (params.get('show') !== 'archived') return <ActiveTasks />

  return (
    <TaskViewPage
      key="archived"
      view="archived"
      title="My Tasks"
      description="Archived tasks are hidden from your lists and dashboard. Restore or delete them here."
      headerActions={<ActiveArchivedSwitch archived />}
      quickAdd={false}
      statuses={['not_started', 'in_progress', 'blocked', 'completed', 'cancelled']}
      sorts={['-created', 'due', 'priority', 'title']}
      defaultSort="-created"
      showOverdueFilter={false}
      empty={{
        icon: ArchiveIcon,
        title: 'No archived tasks',
        description: 'Tasks you archive from the task panel appear here.',
      }}
    />
  )
}
