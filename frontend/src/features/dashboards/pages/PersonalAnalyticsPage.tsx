import { format } from 'date-fns'
import {
  AlarmClockIcon,
  CalendarCheckIcon,
  CircleCheckBigIcon,
  ListTodoIcon,
  TargetIcon,
} from 'lucide-react'
import { motion } from 'motion/react'

import { PageHeader } from '@/components/shared/PageHeader'
import { ErrorState } from '@/components/shared/StatePanels'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { usePersonalDashboard, type DashboardPeriod } from '@/features/dashboards/api'
import { BreakdownBars } from '@/features/dashboards/components/BreakdownBars'
import { CompletionTrendChart } from '@/features/dashboards/components/CompletionTrendChart'
import { StatTile } from '@/features/dashboards/components/StatTile'
import { inZone } from '@/features/tasks/dates'
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type TaskPriority,
  type TaskStatus,
} from '@/features/tasks/task-meta'
import { pageEnter } from '@/lib/motion'
import { useSearchParams } from 'react-router'
import { cn } from '@/lib/utils'

const PERIODS: { value: DashboardPeriod; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
]

export function PersonalAnalyticsPage() {
  const [params, setParams] = useSearchParams()
  const period = (PERIODS.find((p) => p.value === params.get('period'))?.value ??
    '7d') as DashboardPeriod
  const { data, isPending, isError, error, refetch, isPlaceholderData } =
    usePersonalDashboard(period)

  const periodPicker = (
    <div
      role="radiogroup"
      aria-label="Reporting period"
      className="inline-flex rounded-lg bg-muted p-1"
    >
      {PERIODS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={period === option.value}
          onClick={() =>
            setParams(option.value === '7d' ? {} : { period: option.value }, { replace: true })
          }
          className={cn(
            'rounded-md px-3 py-1 text-sm font-medium transition-colors duration-(--duration-fast) outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
            period === option.value
              ? 'bg-card text-foreground shadow-card'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )

  return (
    <motion.div {...pageEnter} className="space-y-4">
      <PageHeader
        title="Personal analytics"
        description="How your own work is going. Only you can see this."
        actions={periodPicker}
      />
      {isPending ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
          <Skeleton className="h-72 rounded-xl sm:col-span-2 lg:col-span-4" />
        </div>
      ) : isError ? (
        <ErrorState
          title="Couldn't load your analytics"
          message={error.message}
          onRetry={() => void refetch()}
        />
      ) : (
        <div className={cn('space-y-6 transition-opacity', isPlaceholderData && 'opacity-60')}>
          <p className="text-xs text-muted-foreground">
            {format(inZone(data.period_start, data.timezone), 'd MMM')} – today · times in{' '}
            {data.timezone}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Completed"
              value={data.counts.completed_in_period}
              icon={CircleCheckBigIcon}
              definition={data.definitions.completed_in_period}
              hint={`${data.counts.created_in_period} created in the same period`}
              to="/personal/completed"
            />
            <StatTile
              label="On-time rate"
              value={data.on_time.rate === null ? '—' : `${Math.round(data.on_time.rate * 100)}%`}
              icon={TargetIcon}
              definition={data.definitions.on_time}
              hint={
                data.on_time.eligible
                  ? `${data.on_time.on_time} of ${data.on_time.eligible} tasks with a deadline`
                  : 'No completed tasks with a deadline yet'
              }
            />
            <StatTile
              label="Overdue"
              value={data.counts.overdue}
              icon={AlarmClockIcon}
              tone={data.counts.overdue > 0 ? 'danger' : 'default'}
              definition={data.definitions.overdue}
              hint={`${data.counts.due_today} due today · ${data.counts.upcoming_7d} in the next 7 days`}
              to="/personal/tasks?overdue=true"
            />
            <StatTile
              label="Open"
              value={data.counts.open}
              icon={ListTodoIcon}
              definition={data.definitions.open}
              to="/personal/tasks"
            />
          </div>

          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarCheckIcon aria-hidden className="size-4 text-primary" />
                Completed per day
              </CardTitle>
              <CardDescription>{data.definitions.period}</CardDescription>
            </CardHeader>
            <CardContent>
              <CompletionTrendChart trend={data.trend} />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle>Open by priority</CardTitle>
                <CardDescription>Where your open work sits right now.</CardDescription>
              </CardHeader>
              <CardContent>
                <BreakdownBars
                  label="Open tasks by priority"
                  items={(['urgent', 'high', 'medium', 'low'] as TaskPriority[]).map(
                    (priority) => ({
                      key: priority,
                      label: PRIORITY_LABELS[priority],
                      value: data.open_by_priority[priority] ?? 0,
                      to: `/personal/tasks?priority=${priority}`,
                    }),
                  )}
                />
              </CardContent>
            </Card>
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle>Open by status</CardTitle>
                <CardDescription>Blocked work is worth a look.</CardDescription>
              </CardHeader>
              <CardContent>
                <BreakdownBars
                  label="Open tasks by status"
                  items={Object.entries(data.open_by_status).map(([status, value]) => ({
                    key: status,
                    label: STATUS_LABELS[status as TaskStatus],
                    value,
                    to: `/personal/tasks?status=${status}`,
                  }))}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </motion.div>
  )
}
