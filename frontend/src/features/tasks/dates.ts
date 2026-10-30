import { TZDate } from '@date-fns/tz'
import { differenceInCalendarDays, format, isSameYear } from 'date-fns'

import type { Task } from '@/features/tasks/types'

/** "Now" as a wall-clock date in the user's profile timezone (not the browser's). */
export function nowIn(timezone: string): TZDate {
  return TZDate.tz(timezone)
}

export function inZone(iso: string, timezone: string): TZDate {
  return new TZDate(iso, timezone)
}

export function localDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export function todayKey(timezone: string): string {
  return localDateKey(nowIn(timezone))
}

/** Human label for a calendar day relative to today: Today, Tomorrow, Yesterday, Wed 5 Nov… */
export function relativeDayLabel(date: Date, timezone: string, { long = false } = {}): string {
  const diff = differenceInCalendarDays(date, nowIn(timezone))
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  const pattern = long ? 'EEEE d MMMM' : 'EEE d MMM'
  return format(date, isSameYear(date, nowIn(timezone)) ? pattern : `${pattern} yyyy`)
}

export function dueLabel(task: Pick<Task, 'due_at' | 'due_all_day'>, timezone: string) {
  if (!task.due_at) return null
  const local = inZone(task.due_at, timezone)
  const day = relativeDayLabel(local, timezone)
  return task.due_all_day ? day : `${day}, ${format(local, 'HH:mm')}`
}

/** Form values (local strings) for a task's dates. */
export function dateInputs(task: Task, timezone: string) {
  const due = task.due_at ? inZone(task.due_at, timezone) : null
  const start = task.start_at ? inZone(task.start_at, timezone) : null
  return {
    due_date: due ? localDateKey(due) : '',
    due_time: due && !task.due_all_day ? format(due, 'HH:mm') : '',
    start_date: start ? localDateKey(start) : '',
  }
}
