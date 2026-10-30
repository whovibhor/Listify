import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleSlashIcon,
  EyeIcon,
  OctagonPauseIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  MinusIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type TaskPriority,
  type TaskStatus,
} from '@/features/tasks/task-meta'

// Icon + label + color: status is never conveyed by color alone (PRD §7, WCAG 1.4.1).
const STATUS_STYLES: Record<TaskStatus, { icon: LucideIcon; className: string }> = {
  not_started: {
    icon: CircleDashedIcon,
    className: 'text-status-not-started bg-status-not-started/10',
  },
  in_progress: {
    icon: CircleDotIcon,
    className: 'text-status-in-progress bg-status-in-progress/10',
  },
  blocked: { icon: OctagonPauseIcon, className: 'text-status-blocked bg-status-blocked/10' },
  in_review: { icon: EyeIcon, className: 'text-status-in-review bg-status-in-review/10' },
  completed: { icon: CircleCheckIcon, className: 'text-status-completed bg-status-completed/10' },
  cancelled: { icon: CircleSlashIcon, className: 'text-status-cancelled bg-status-cancelled/10' },
}

const PRIORITY_STYLES: Record<TaskPriority, { icon: LucideIcon; className: string }> = {
  // Arrows read clearly at 14px; signal-bar icons looked like stray punctuation for "low".
  low: { icon: ArrowDownIcon, className: 'text-priority-low' },
  medium: { icon: MinusIcon, className: 'text-priority-medium' },
  high: { icon: ArrowUpIcon, className: 'text-priority-high' },
  urgent: { icon: TriangleAlertIcon, className: 'text-priority-urgent' },
}

const badgeBase =
  'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap transition-colors duration-(--duration-base)'

export function TaskStatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const { icon: Icon, className: tone } = STATUS_STYLES[status]
  return (
    <span data-status={status} className={cn(badgeBase, tone, className)}>
      <Icon aria-hidden className="size-3.5" />
      {STATUS_LABELS[status]}
    </span>
  )
}

export function TaskPriorityBadge({
  priority,
  className,
}: {
  priority: TaskPriority
  className?: string
}) {
  const { icon: Icon, className: tone } = PRIORITY_STYLES[priority]
  return (
    <span data-priority={priority} className={cn(badgeBase, 'bg-muted', tone, className)}>
      <Icon aria-hidden className="size-3.5" />
      <span className="text-foreground/80">{PRIORITY_LABELS[priority]}</span>
    </span>
  )
}
