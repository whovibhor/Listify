import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parse,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'

import { ErrorState } from '@/components/shared/StatePanels'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DueChip } from '@/features/tasks/components/DueChip'
import { inZone, localDateKey, nowIn, todayKey } from '@/features/tasks/dates'
import type { Task } from '@/features/tasks/types'
import { useOrganizationTasks, type WorkParams } from '@/features/work/api'
import { cn } from '@/lib/utils'

const WEEK = { weekStartsOn: 1 } as const
const MONTH_FORMAT = 'yyyy-MM'
const MAX_TASKS = 100
const VISIBLE_PER_DAY = 3
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface WorkCalendarProps {
  organizationId: number
  params: WorkParams
  timezone: string
  /** yyyy-MM; defaults to this month in the organization's time zone. */
  month: string | null
  onMonthChange: (month: string) => void
  onOpen: (id: number) => void
}

function DayTask({
  task,
  timezone,
  onOpen,
}: Pick<WorkCalendarProps, 'timezone' | 'onOpen'> & { task: Task }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(task.id)}
      className={cn(
        'block w-full truncate rounded-md bg-muted/60 px-1.5 py-1 text-left text-xs font-medium outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50',
        task.is_overdue && 'text-destructive',
        (task.status === 'completed' || task.status === 'cancelled') &&
          'text-muted-foreground line-through',
      )}
    >
      <span className="sr-only">
        {task.is_overdue ? 'Overdue: ' : ''}
        {format(inZone(task.due_at!, timezone), 'EEEE d MMMM')}:{' '}
      </span>
      {task.title}
    </button>
  )
}

/** Tasks by deadline: a month grid on larger screens, an agenda of busy days on phones. */
export function WorkCalendar({
  organizationId,
  params,
  timezone,
  month,
  onMonthChange,
  onOpen,
}: WorkCalendarProps) {
  const shown = month ? parse(month, MONTH_FORMAT, new Date()) : startOfMonth(nowIn(timezone))
  const gridStart = startOfWeek(startOfMonth(shown), WEEK)
  const gridEnd = endOfWeek(endOfMonth(shown), WEEK)
  const { data, isPending, isError, error, refetch } = useOrganizationTasks(organizationId, {
    ...params,
    due_from: localDateKey(gridStart),
    due_to: localDateKey(gridEnd),
    page_size: MAX_TASKS,
  })

  const days: Date[] = []
  for (let day = gridStart; day <= gridEnd; day = addDays(day, 1)) days.push(day)
  const byDay = new Map<string, Task[]>()
  for (const task of data?.items ?? []) {
    if (!task.due_at) continue
    const key = localDateKey(inZone(task.due_at, timezone))
    byDay.set(key, [...(byDay.get(key) ?? []), task])
  }
  const today = todayKey(timezone)
  const busyDays = days.filter((day) => byDay.has(localDateKey(day)) && isSameMonth(day, shown))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold" aria-live="polite">
          {format(shown, 'MMMM yyyy')}
        </h2>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous month"
            onClick={() => onMonthChange(format(addMonths(shown, -1), MONTH_FORMAT))}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next month"
            onClick={() => onMonthChange(format(addMonths(shown, 1), MONTH_FORMAT))}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      </div>

      {isPending ? (
        <Skeleton className="h-96 w-full rounded-2xl" />
      ) : isError ? (
        <ErrorState message={error.message} onRetry={() => void refetch()} />
      ) : (
        <>
          {data.total > data.items.length ? (
            <p className="text-sm text-muted-foreground">
              Showing the first {data.items.length} of {data.total} tasks. Filter to see the rest.
            </p>
          ) : null}

          <div className="hidden overflow-hidden rounded-2xl bg-card shadow-card md:block">
            <div className="grid grid-cols-7 text-xs font-medium text-muted-foreground">
              {WEEKDAYS.map((weekday) => (
                <div key={weekday} className="px-2 py-2">
                  {weekday}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px bg-border/60">
              {days.map((day) => {
                const key = localDateKey(day)
                const tasks = byDay.get(key) ?? []
                const extra = tasks.length - VISIBLE_PER_DAY
                return (
                  <div
                    key={key}
                    data-testid={`day-${key}`}
                    className={cn(
                      'min-h-28 min-w-0 space-y-1 bg-card p-1.5',
                      !isSameMonth(day, shown) && 'bg-muted/30 text-muted-foreground',
                    )}
                  >
                    <p
                      className={cn(
                        'grid size-6 place-items-center rounded-full text-xs tabular-nums',
                        key === today && 'bg-primary font-semibold text-primary-foreground',
                      )}
                    >
                      {format(day, 'd')}
                    </p>
                    {tasks.slice(0, VISIBLE_PER_DAY).map((task) => (
                      <DayTask key={task.id} task={task} timezone={timezone} onOpen={onOpen} />
                    ))}
                    {extra > 0 ? (
                      <p className="px-1 text-xs text-muted-foreground">+{extra} more</p>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="space-y-3 md:hidden">
            {busyDays.length === 0 ? (
              <p className="rounded-2xl bg-card p-4 text-sm text-muted-foreground shadow-card">
                No deadlines this month.
              </p>
            ) : null}
            {busyDays.map((day) => {
              const key = localDateKey(day)
              return (
                <section key={key} className="space-y-1.5 rounded-2xl bg-card p-3 shadow-card">
                  <h3 className="text-sm font-semibold">{format(day, 'EEEE d MMMM')}</h3>
                  <ul className="space-y-1">
                    {byDay.get(key)?.map((task) => (
                      <li key={task.id}>
                        <button
                          type="button"
                          onClick={() => onOpen(task.id)}
                          className="flex w-full items-center justify-between gap-2 rounded-lg bg-muted/60 px-2.5 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          <span className="min-w-0 truncate">{task.title}</span>
                          <DueChip task={task} timezone={timezone} className="shrink-0" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
