import { AlarmClockIcon, CalendarIcon } from 'lucide-react'

import { dueLabel } from '@/features/tasks/dates'
import type { Task } from '@/features/tasks/types'
import { cn } from '@/lib/utils'

interface DueChipProps {
  task: Pick<Task, 'due_at' | 'due_all_day' | 'is_overdue' | 'status'>
  timezone: string
  className?: string
}

/** Deadline with an explicit "Overdue" word, so the state isn't conveyed by color alone. */
export function DueChip({ task, timezone, className }: DueChipProps) {
  const label = dueLabel(task, timezone)
  if (!label) return null
  const overdue = task.is_overdue
  const Icon = overdue ? AlarmClockIcon : CalendarIcon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs whitespace-nowrap',
        overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {overdue ? <span className="sr-only">Overdue: </span> : null}
      {label}
      {overdue ? <span aria-hidden> · Overdue</span> : null}
    </span>
  )
}
