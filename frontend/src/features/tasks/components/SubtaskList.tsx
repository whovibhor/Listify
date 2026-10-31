import { useState, type FormEvent } from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCreateTask, useDeleteTask, useTaskAction } from '@/features/tasks/api'
import { TaskCheckbox } from '@/features/tasks/components/TaskCheckbox'
import { TaskLink } from '@/features/tasks/components/TaskLink'
import type { TaskDetail } from '@/features/tasks/types'
import { transitions } from '@/lib/motion'
import { cn } from '@/lib/utils'

export function SubtaskList({ task, readOnly }: { task: TaskDetail; readOnly: boolean }) {
  const [title, setTitle] = useState('')
  const create = useCreateTask(task.organization_id)
  const action = useTaskAction()
  const remove = useDeleteTask()

  const add = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    // Clear now, not on success: the user may already be typing the next subtask.
    setTitle('')
    create.mutate(
      { title: trimmed, parent_task_id: task.id },
      {
        onError: (error) => {
          toast.error(error.message)
          setTitle((current) => current || trimmed)
        },
      },
    )
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        <AnimatePresence initial={false}>
          {task.subtasks.map((subtask) => {
            const done = subtask.status === 'completed'
            return (
              <motion.li
                key={subtask.id}
                layout="position"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={transitions.fast}
                className="group flex items-center gap-2.5 rounded-md px-1 py-1 hover:bg-muted/60"
              >
                <TaskCheckbox
                  size="sm"
                  checked={done}
                  disabled={readOnly || subtask.status === 'cancelled'}
                  label={
                    done
                      ? `Reopen subtask “${subtask.title}”`
                      : `Complete subtask “${subtask.title}”`
                  }
                  onToggle={() =>
                    action.mutate(
                      { id: subtask.id, action: done ? 'reopen' : 'complete' },
                      { onError: (error) => toast.error(error.message) },
                    )
                  }
                />
                <TaskLink
                  task={subtask}
                  className={cn(
                    'flex-1 truncate text-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50',
                    (done || subtask.status === 'cancelled') &&
                      'text-muted-foreground line-through',
                  )}
                >
                  {subtask.title}
                </TaskLink>
                {readOnly ? null : (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Delete subtask “${subtask.title}”`}
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() =>
                      remove.mutate(subtask.id, { onError: (error) => toast.error(error.message) })
                    }
                  >
                    <Trash2Icon />
                  </Button>
                )}
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ul>
      {readOnly ? null : (
        <form onSubmit={add} className="flex gap-2">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Add a subtask"
            aria-label="New subtask title"
            maxLength={200}
            className="h-8"
          />
          {/* Not disabled while saving: browsers ignore Enter when a form's submit button is
              disabled, which would silently drop a subtask typed during the previous save. */}
          <Button type="submit" variant="outline" size="sm" disabled={!title.trim()}>
            <PlusIcon data-icon="inline-start" />
            Add
          </Button>
        </form>
      )}
    </div>
  )
}
