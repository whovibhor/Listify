import { addDays, differenceInCalendarDays } from 'date-fns'

import type { TaskGroup } from '@/features/tasks/components/TaskList'
import { inZone, localDateKey, nowIn, relativeDayLabel, todayKey } from '@/features/tasks/dates'
import type { Task } from '@/features/tasks/types'

/** My Day: Overdue first, then due today, then work scheduled to start by today. */
export function groupMyDay(tasks: Task[], timezone: string): TaskGroup[] {
  const today = todayKey(timezone)
  const overdue: Task[] = []
  const dueToday: Task[] = []
  const started: Task[] = []
  for (const task of tasks) {
    if (task.is_overdue) overdue.push(task)
    else if (task.due_at && localDateKey(inZone(task.due_at, timezone)) === today)
      dueToday.push(task)
    else started.push(task)
  }
  return [
    { key: 'overdue', label: 'Overdue', tasks: overdue },
    { key: 'today', label: 'Due today', tasks: dueToday },
    { key: 'started', label: 'Scheduled to start', tasks: started },
  ].filter((group) => group.tasks.length > 0)
}

export type WhenBucket = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'none'

export const WHEN_ORDER: WhenBucket[] = ['overdue', 'today', 'tomorrow', 'week', 'later', 'none']

/** My Tasks: plan by when things are due. "This week" = the 5 days after tomorrow. */
export function groupByWhen(tasks: Task[], timezone: string): Record<WhenBucket, Task[]> {
  const today = nowIn(timezone)
  const groups: Record<WhenBucket, Task[]> = {
    overdue: [],
    today: [],
    tomorrow: [],
    week: [],
    later: [],
    none: [],
  }
  for (const task of tasks) {
    if (!task.due_at) groups.none.push(task)
    else if (task.is_overdue) groups.overdue.push(task)
    else {
      const days = differenceInCalendarDays(inZone(task.due_at, timezone), today)
      if (days <= 0) groups.today.push(task)
      else if (days === 1) groups.tomorrow.push(task)
      else if (days <= 6) groups.week.push(task)
      else groups.later.push(task)
    }
  }
  return groups
}

/** Upcoming: the 14 local days after today, with task counts (days without tasks included). */
export function upcomingDays(tasks: Task[], timezone: string) {
  const byDay = new Map<string, Task[]>()
  for (const task of tasks) {
    if (!task.due_at) continue
    const key = localDateKey(inZone(task.due_at, timezone))
    byDay.set(key, [...(byDay.get(key) ?? []), task])
  }
  const start = nowIn(timezone)
  return Array.from({ length: 14 }, (_, index) => {
    const date = addDays(start, index + 1)
    const key = localDateKey(date)
    const dayTasks = byDay.get(key) ?? []
    return { key, date, label: relativeDayLabel(date, timezone, { long: true }), tasks: dayTasks }
  })
}
