import { useId, useState, type ReactNode } from 'react'
import { ChevronDownIcon, type LucideIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'

import { TaskRows } from '@/features/tasks/components/TaskList'
import type { Task } from '@/features/tasks/types'
import { transitions } from '@/lib/motion'
import { cn } from '@/lib/utils'

export type SectionTone = 'danger' | 'primary' | 'info' | 'neutral' | 'success'

// Tone colors the icon chip; the section title always says what it is in words.
const TONES: Record<SectionTone, string> = {
  danger: 'bg-destructive/10 text-destructive',
  primary: 'bg-accent text-accent-foreground',
  info: 'bg-info/10 text-info',
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-success/10 text-success',
}

interface TaskSectionProps {
  title: string
  icon: LucideIcon
  tone: SectionTone
  tasks: Task[]
  timezone: string
  description?: ReactNode
  defaultOpen?: boolean
  /** Total on the server when only part of the section is loaded. */
  totalLabel?: string
}

/** A titled, collapsible group of tasks; the toned icon is backed by a title and a count. */
export function TaskSection({
  title,
  icon: Icon,
  tone,
  tasks,
  description,
  defaultOpen = true,
  totalLabel,
  ...rowProps
}: TaskSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const contentId = useId()

  return (
    <section className="overflow-hidden rounded-2xl bg-card shadow-card">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
          <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', TONES[tone])}>
            <Icon aria-hidden className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="font-semibold">{title}</span>
              <span className="rounded-full bg-muted px-2 py-px text-xs font-medium text-muted-foreground tabular-nums">
                {totalLabel ?? tasks.length}
              </span>
            </span>
            {description ? (
              <span className="block truncate text-xs text-muted-foreground">{description}</span>
            ) : null}
          </span>
          <ChevronDownIcon
            aria-hidden
            className={cn(
              'size-4 text-muted-foreground transition-transform duration-(--duration-base)',
              !open && '-rotate-90',
            )}
          />
        </button>
      </h2>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={contentId}
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={transitions.base}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3">
              <TaskRows nested tasks={tasks} {...rowProps} />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  )
}
