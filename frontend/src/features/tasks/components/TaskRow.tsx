import { forwardRef } from 'react'
import { ListChecksIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { toast } from 'sonner'

import { useToggleComplete } from '@/features/tasks/api'
import { DueChip } from '@/features/tasks/components/DueChip'
import { TagChip } from '@/features/tasks/components/TagChip'
import { TaskCheckbox } from '@/features/tasks/components/TaskCheckbox'
import { TaskPriorityBadge, TaskStatusBadge } from '@/features/tasks/components/TaskBadges'
import type { Task } from '@/features/tasks/types'
import { transitions } from '@/lib/motion'
import { cn } from '@/lib/utils'

interface TaskRowProps {
  task: Task
  timezone: string
  onOpen: (id: number) => void
  selected?: boolean
  /** Inside another card: a tinted fill replaces the row's own card surface and shadow. */
  nested?: boolean
}

export const TaskRow = forwardRef<HTMLLIElement, TaskRowProps>(function TaskRow(
  { task, timezone, onOpen, selected, nested },
  ref,
) {
  const toggle = useToggleComplete()
  const done = task.status === 'completed'
  const showStatus = task.status !== 'not_started' && task.status !== 'completed'

  const onToggle = () =>
    toggle.mutate(
      { task },
      {
        onSuccess: () =>
          toast.success(done ? 'Task reopened' : 'Task completed', { description: task.title }),
        onError: (error) => toast.error(error.message),
      },
    )

  return (
    <motion.li
      ref={ref}
      layout="position"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0 }}
      transition={transitions.base}
      className={cn(
        'group relative flex items-start gap-3 rounded-lg px-3 py-2.5 transition-[background-color,box-shadow] duration-(--duration-fast)',
        nested ? 'bg-muted/60 hover:bg-accent/60' : 'bg-card shadow-card hover:shadow-raised',
        selected && 'bg-accent!',
      )}
    >
      {/* Above the row-wide click target of the title button. */}
      <div className="relative z-10 pt-0.5">
        <TaskCheckbox
          checked={done}
          onToggle={onToggle}
          disabled={toggle.isPending || task.archived_at !== null || task.status === 'cancelled'}
          label={done ? `Reopen “${task.title}”` : `Complete “${task.title}”`}
        />
      </div>
      <button
        type="button"
        onClick={() => onOpen(task.id)}
        className="min-w-0 flex-1 text-left outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
      >
        <span
          className={cn(
            'block truncate text-sm font-medium transition-colors duration-(--duration-base)',
            (done || task.status === 'cancelled') && 'text-muted-foreground line-through',
          )}
        >
          {task.title}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          {showStatus ? <TaskStatusBadge status={task.status} /> : null}
          {task.priority !== 'medium' ? <TaskPriorityBadge priority={task.priority} /> : null}
          <DueChip task={task} timezone={timezone} />
          {task.subtask_count > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
              <ListChecksIcon aria-hidden className="size-3.5" />
              <span className="sr-only">Subtasks completed: </span>
              {task.subtasks_completed}/{task.subtask_count}
            </span>
          ) : null}
          {task.tags.map((tag) => (
            <TagChip key={tag.id} tag={tag} />
          ))}
        </span>
      </button>
    </motion.li>
  )
})
