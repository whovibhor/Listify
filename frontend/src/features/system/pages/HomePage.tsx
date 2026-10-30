import { motion } from 'motion/react'
import {
  AlarmClockIcon,
  ArrowRightIcon,
  CircleCheckBigIcon,
  ListTodoIcon,
  SunIcon,
} from 'lucide-react'
import { Link } from 'react-router'

import { PageHeader } from '@/components/shared/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { useMe } from '@/features/auth/api'
import { usePersonalDashboard } from '@/features/dashboards/api'
import { StatTile } from '@/features/dashboards/components/StatTile'
import { useTasks } from '@/features/tasks/api'
import { DueChip } from '@/features/tasks/components/DueChip'
import { QuickAddTask } from '@/features/tasks/components/QuickAddTask'
import { todayKey } from '@/features/tasks/dates'
import { SystemStatusCard } from '@/features/system/components/SystemStatusCard'
import { pageEnter } from '@/lib/motion'

function TodayPreview({ timezone }: { timezone: string }) {
  const { data, isPending } = useTasks({ view: 'my_day', page_size: 5 })
  return (
    <section aria-labelledby="today-heading" className="rounded-xl bg-card p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="today-heading" className="flex items-center gap-2 font-semibold">
          <SunIcon aria-hidden className="size-4 text-primary" />
          Today
        </h2>
        <Link
          to="/personal/my-day"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Open My Day
          <ArrowRightIcon aria-hidden className="size-4" />
        </Link>
      </div>
      {isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : data && data.items.length > 0 ? (
        <ul className="divide-y">
          {data.items.map((task) => (
            <li key={task.id} className="flex items-center justify-between gap-3 py-2">
              <Link
                to={`/personal/my-day?task=${task.id}`}
                className="min-w-0 truncate text-sm font-medium hover:underline"
              >
                {task.title}
              </Link>
              <DueChip task={task} timezone={timezone} />
            </li>
          ))}
          {data.total > data.items.length ? (
            <li className="pt-2 text-xs text-muted-foreground">
              +{data.total - data.items.length} more
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="py-4 text-sm text-muted-foreground">
          Nothing overdue or due today. Enjoy the calm.
        </p>
      )}
    </section>
  )
}

export function HomePage() {
  const { data: user } = useMe()
  const timezone = user?.timezone ?? 'UTC'
  const firstName = user?.name.split(' ')[0]
  const { data: dashboard } = usePersonalDashboard('7d')

  return (
    <motion.div {...pageEnter} className="space-y-6">
      <PageHeader
        title={firstName ? `Hi, ${firstName}` : 'Welcome to Listify'}
        description="Here's where your personal work stands."
      />
      <QuickAddTask
        defaults={{ due_date: todayKey(timezone) }}
        placeholder="Add a task for today…"
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {dashboard ? (
          <>
            <StatTile
              label="Due today"
              value={dashboard.counts.due_today}
              icon={SunIcon}
              definition={dashboard.definitions.due_today}
              to="/personal/my-day"
            />
            <StatTile
              label="Overdue"
              value={dashboard.counts.overdue}
              icon={AlarmClockIcon}
              tone={dashboard.counts.overdue > 0 ? 'danger' : 'default'}
              definition={dashboard.definitions.overdue}
              to="/personal/tasks?overdue=true"
            />
            <StatTile
              label="Completed this week"
              value={dashboard.counts.completed_in_period}
              icon={CircleCheckBigIcon}
              definition={`${dashboard.definitions.completed_in_period} Period: the last 7 days.`}
              to="/personal/analytics"
            />
          </>
        ) : (
          Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
        )}
      </div>
      {/* minmax(0,…) lets long task titles truncate instead of widening the column. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <TodayPreview timezone={timezone} />
        <div className="space-y-6">
          {dashboard ? (
            <Link
              to="/personal/tasks"
              className="flex items-center gap-3 rounded-xl bg-card p-4 shadow-card transition-shadow hover:shadow-raised"
            >
              <ListTodoIcon aria-hidden className="size-5 text-primary" />
              <span className="flex-1 text-sm">
                <span className="font-semibold">{dashboard.counts.open}</span> open tasks in total
              </span>
              <ArrowRightIcon aria-hidden className="size-4 text-muted-foreground" />
            </Link>
          ) : null}
          <SystemStatusCard />
        </div>
      </div>
    </motion.div>
  )
}
