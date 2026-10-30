import { useRef, useState, type FormEvent } from 'react'
import { CornerDownLeftIcon, Loader2Icon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Input } from '@/components/ui/input'
import { useCreateTask } from '@/features/tasks/api'
import type { TaskInput } from '@/features/tasks/types'
import { cn } from '@/lib/utils'

interface QuickAddTaskProps {
  /** Extra fields for tasks created here, e.g. today's date on My Day. */
  defaults?: Omit<TaskInput, 'title'>
  placeholder?: string
  className?: string
}

/** Type a title, press Enter: the fastest path to a new task (NFR-06). */
export function QuickAddTask({
  defaults,
  placeholder = 'Add a task…',
  className,
}: QuickAddTaskProps) {
  const [title, setTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const create = useCreateTask()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    // Clear immediately so rapid entry works; a failed save puts the text back.
    setTitle('')
    inputRef.current?.focus()
    create.mutate(
      { ...defaults, title: trimmed },
      {
        onError: (error) => {
          toast.error(error.message)
          setTitle((current) => current || trimmed)
        },
      },
    )
  }

  return (
    <form onSubmit={submit} className={cn('relative', className)}>
      <label htmlFor="quick-add" className="sr-only">
        New task title
      </label>
      <PlusIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        id="quick-add"
        ref={inputRef}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder={placeholder}
        maxLength={200}
        autoComplete="off"
        className="h-11 rounded-xl bg-card pr-12 pl-9 shadow-card"
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground">
        {create.isPending ? (
          <Loader2Icon aria-label="Adding task" className="size-4 animate-spin" />
        ) : title.trim() ? (
          <CornerDownLeftIcon aria-hidden className="size-4" />
        ) : null}
      </span>
    </form>
  )
}
