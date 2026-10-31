import { format } from 'date-fns'
import {
  AlarmClockIcon,
  CircleCheckBigIcon,
  PartyPopperIcon,
  PlayIcon,
  SunIcon,
  SunriseIcon,
} from 'lucide-react'
import { motion } from 'motion/react'

import { ErrorState } from '@/components/shared/StatePanels'
import { useMe } from '@/features/auth/api'
import { ProgressRing } from '@/features/personal-tasks/components/ProgressRing'
import { TaskSection } from '@/features/personal-tasks/components/TaskSection'
import { groupMyDay } from '@/features/personal-tasks/grouping'
import { useTasks } from '@/features/tasks/api'
import { QuickAddTask } from '@/features/tasks/components/QuickAddTask'
import { TaskListSkeleton } from '@/features/tasks/components/TaskList'
import { nowIn, todayKey } from '@/features/tasks/dates'
import { pageEnter } from '@/lib/motion'

const SECTION_META = {
  overdue: {
    title: 'Overdue',
    icon: AlarmClockIcon,
    tone: 'danger',
    description: 'Past their deadline',
  },
  today: { title: 'Due today', icon: SunIcon, tone: 'primary', description: 'Deadline is today' },
  started: {
    title: 'Starting today',
    icon: PlayIcon,
    tone: 'info',
    description: 'Scheduled to start by today',
  },
} as const

function greeting(hour: number) {
  if (hour < 5) return 'Working late'
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function MyDayPage() {
  const { data: user } = useMe()
  const timezone = user?.timezone ?? 'UTC'
  const now = nowIn(timezone)

  const remaining = useTasks({ view: 'my_day', page_size: 100 })
  const done = useTasks({ view: 'done_today', page_size: 100 })

  const remainingTotal = remaining.data?.total ?? 0
  const doneTotal = done.data?.total ?? 0
  const groups = remaining.data ? groupMyDay(remaining.data.items, timezone) : []
  const overdueCount = groups.find((g) => g.key === 'overdue')?.tasks.length ?? 0
  const rowProps = { timezone }

  return (
    <motion.div {...pageEnter} className="mx-auto max-w-4xl space-y-5">
      {/* Hero: date, greeting, progress and quick add in one place. */}
      <section
        aria-labelledby="my-day-title"
        className="relative overflow-hidden rounded-3xl bg-linear-to-br from-accent via-card to-card p-5 shadow-card sm:p-7"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-16 -right-10 size-56 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative flex items-center justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
              <SunriseIcon aria-hidden className="size-4" />
              {greeting(now.getHours())}
              {user ? `, ${user.name.split(' ')[0]}` : ''}
            </p>
            <h1 id="my-day-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
              My Day
            </h1>
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">{format(now, 'EEEE')}</span>,{' '}
              {format(now, 'd MMMM')}
            </p>
            <p className="pt-1 text-sm text-muted-foreground">
              {remaining.isPending
                ? 'Loading your day…'
                : remainingTotal === 0
                  ? 'Nothing left for today.'
                  : `${remainingTotal} to do${overdueCount ? ` · ${overdueCount} overdue` : ''}`}
            </p>
          </div>
          <ProgressRing done={doneTotal} total={doneTotal + remainingTotal} size={84} />
        </div>
        <QuickAddTask
          className="relative mt-5"
          defaults={{ due_date: todayKey(timezone) }}
          placeholder="Add a task for today…"
        />
      </section>

      {remaining.isPending ? (
        <TaskListSkeleton />
      ) : remaining.isError ? (
        <ErrorState
          title="Couldn't load your day"
          message={remaining.error.message}
          onRetry={() => void remaining.refetch()}
        />
      ) : remainingTotal === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-card px-6 py-10 text-center shadow-card">
          <span className="grid size-12 place-items-center rounded-full bg-success/10 text-success">
            {doneTotal > 0 ? (
              <PartyPopperIcon aria-hidden className="size-6" />
            ) : (
              <SunIcon aria-hidden className="size-6" />
            )}
          </span>
          <div className="space-y-1">
            <h2 className="font-semibold">
              {doneTotal > 0 ? 'All done for today' : 'Your day is clear'}
            </h2>
            <p className="mx-auto max-w-sm text-sm text-muted-foreground">
              {doneTotal > 0
                ? `You finished ${doneTotal} task${doneTotal === 1 ? '' : 's'} today. Nice work.`
                : 'Nothing overdue or due today. Add a task above, or plan ahead in My Tasks.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const meta = SECTION_META[group.key as keyof typeof SECTION_META]
            return (
              <TaskSection
                key={group.key}
                title={meta.title}
                icon={meta.icon}
                tone={meta.tone}
                description={meta.description}
                tasks={group.tasks}
                {...rowProps}
              />
            )
          })}
        </div>
      )}

      {/* Wait for the remaining list: its count decides whether this starts expanded. */}
      {doneTotal > 0 && !remaining.isPending ? (
        <TaskSection
          title="Done today"
          icon={CircleCheckBigIcon}
          tone="success"
          description="Untick a task to reopen it"
          defaultOpen={remainingTotal === 0}
          tasks={done.data?.items ?? []}
          {...rowProps}
        />
      ) : null}
    </motion.div>
  )
}
