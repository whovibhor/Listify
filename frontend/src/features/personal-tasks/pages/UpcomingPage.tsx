import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { CalendarClockIcon } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'

import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState, ErrorState } from '@/components/shared/StatePanels'
import { useMe } from '@/features/auth/api'
import { DayStrip } from '@/features/personal-tasks/components/DayStrip'
import { upcomingDays } from '@/features/personal-tasks/grouping'
import { useTasks } from '@/features/tasks/api'
import { QuickAddTask } from '@/features/tasks/components/QuickAddTask'
import { TaskDetailSheet } from '@/features/tasks/components/TaskDetailSheet'
import { TaskListSkeleton, TaskRows } from '@/features/tasks/components/TaskList'
import { relativeDayLabel } from '@/features/tasks/dates'
import { useTaskSearchParams } from '@/features/tasks/use-task-search-params'
import { pageEnter } from '@/lib/motion'
import { cn } from '@/lib/utils'

export function UpcomingPage() {
  const { data: user } = useMe()
  const timezone = user?.timezone ?? 'UTC'
  const { openTaskId, openTask } = useTaskSearchParams()
  const reduceMotion = useReducedMotion()
  const query = useTasks({ view: 'upcoming', sort: 'due', page_size: 100 })

  const days = useMemo(
    () => upcomingDays(query.data?.items ?? [], timezone),
    [query.data, timezone],
  )
  const [chosen, setChosen] = useState<string | null>(null)
  const selected = chosen ?? days.find((day) => day.tasks.length > 0)?.key ?? days[0]?.key ?? null
  const selectedDay = days.find((day) => day.key === selected)
  const daysWithTasks = days.filter((day) => day.tasks.length > 0)

  const selectDay = (key: string) => {
    setChosen(key)
    document
      .getElementById(`day-${key}`)
      ?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <motion.div {...pageEnter} className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="Upcoming"
        description="The next two weeks at a glance. Pick a day to plan it."
      />

      <DayStrip
        days={days.map((day) => ({ key: day.key, date: day.date, count: day.tasks.length }))}
        selected={selected}
        onSelect={selectDay}
      />

      {selectedDay ? (
        <QuickAddTask
          key={selectedDay.key}
          defaults={{ due_date: selectedDay.key }}
          placeholder={`Add a task for ${relativeDayLabel(selectedDay.date, timezone).toLowerCase() === 'tomorrow' ? 'tomorrow' : format(selectedDay.date, 'EEE d MMM')}…`}
        />
      ) : null}

      {query.isPending ? (
        <TaskListSkeleton />
      ) : query.isError ? (
        <ErrorState
          title="Couldn't load upcoming tasks"
          message={query.error.message}
          onRetry={() => void query.refetch()}
        />
      ) : daysWithTasks.length === 0 ? (
        <EmptyState
          icon={CalendarClockIcon}
          title="Nothing due in the next two weeks"
          description="Pick a day above and add a task, or give existing tasks a deadline."
        />
      ) : (
        <ol className="space-y-3">
          {daysWithTasks.map((day) => (
            <li
              key={day.key}
              id={`day-${day.key}`}
              className={cn(
                'scroll-mt-20 rounded-2xl bg-card p-3 shadow-card transition-[background-color,box-shadow] duration-(--duration-base) sm:grid sm:grid-cols-[4.5rem_1fr] sm:gap-4 sm:p-4',
                day.key === selected && 'shadow-raised',
              )}
            >
              <h2 className="mb-2 flex items-baseline gap-2 sm:mb-0 sm:flex-col sm:items-center sm:gap-0 sm:pt-1 sm:text-center">
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {format(day.date, 'EEE')}
                </span>
                <span className="text-2xl leading-none font-semibold sm:text-3xl">
                  {format(day.date, 'd')}
                </span>
                <span className="text-xs text-muted-foreground">
                  {format(day.date, 'MMM')}
                  <span className="sr-only">
                    {' '}
                    ({day.label}, {day.tasks.length} task{day.tasks.length === 1 ? '' : 's'})
                  </span>
                </span>
              </h2>
              <TaskRows
                nested
                tasks={day.tasks}
                timezone={timezone}
                onOpen={openTask}
                selectedId={openTaskId}
              />
            </li>
          ))}
          {query.data.total > query.data.items.length ? (
            <li className="text-center text-xs text-muted-foreground">
              Showing the first {query.data.items.length} of {query.data.total} upcoming tasks.
            </li>
          ) : null}
        </ol>
      )}

      <TaskDetailSheet taskId={openTaskId} timezone={timezone} onClose={() => openTask(null)} />
    </motion.div>
  )
}
