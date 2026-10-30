import { useState, type ReactNode } from 'react'
import { ArchiveIcon, ArchiveRestoreIcon, Trash2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import { ErrorState } from '@/components/shared/StatePanels'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  useDeleteTask,
  useTask,
  useTaskAction,
  useToggleComplete,
  useUpdateTask,
} from '@/features/tasks/api'
import { ActivityTimeline } from '@/features/tasks/components/ActivityTimeline'
import { SubtaskList } from '@/features/tasks/components/SubtaskList'
import { TagChip } from '@/features/tasks/components/TagChip'
import { TagPicker } from '@/features/tasks/components/TagPicker'
import { TaskCheckbox } from '@/features/tasks/components/TaskCheckbox'
import { dateInputs } from '@/features/tasks/dates'
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_PRIORITIES,
  type TaskPriority,
  type TaskStatus,
} from '@/features/tasks/task-meta'
import type { TaskDetail, TaskInput } from '@/features/tasks/types'
import { TaskPeopleFields } from '@/features/work/components/TaskPeopleFields'
import { ApiError } from '@/lib/api-client'

// Personal tasks never require review, so "In review" isn't offered here (ADR-015).
const PERSONAL_STATUSES: TaskStatus[] = [
  'not_started',
  'in_progress',
  'blocked',
  'completed',
  'cancelled',
]

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-center gap-3">
      <label htmlFor={htmlFor} className="text-sm text-muted-foreground">
        {label}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

function TaskEditor({
  task,
  timezone,
  onClose,
}: {
  task: TaskDetail
  timezone: string
  onClose: () => void
}) {
  const update = useUpdateTask(task.id)
  const action = useTaskAction()
  const toggle = useToggleComplete()
  const remove = useDeleteTask()
  const isOrganizationTask = task.organization_id !== null
  const archived = task.archived_at !== null
  const readOnly = archived || (isOrganizationTask && !task.actions.includes('edit'))
  const canArchive = !isOrganizationTask || task.actions.includes('archive')
  const statuses = isOrganizationTask ? [task.status, ...task.allowed_statuses] : PERSONAL_STATUSES
  const canToggle = !isOrganizationTask
    ? true
    : task.allowed_statuses.includes(task.status === 'completed' ? 'in_progress' : 'completed')
  const dates = dateInputs(task, timezone)
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description ?? '')
  // Pick up server changes (e.g. after a save) without remounting, so focus is never lost.
  const [synced, setSynced] = useState({ title: task.title, description: task.description })
  if (synced.title !== task.title || synced.description !== task.description) {
    setSynced({ title: task.title, description: task.description })
    setTitle(task.title)
    setDescription(task.description ?? '')
  }

  const save = (input: TaskInput, success?: string) =>
    update.mutate(input, {
      onSuccess: () => (success ? toast.success(success) : undefined),
      onError: (error) => {
        const detail = error instanceof ApiError ? error.details[0]?.message : undefined
        toast.error(detail ? `${error.message} ${detail}` : error.message)
        setTitle(task.title)
        setDescription(task.description ?? '')
      },
    })

  const saveTitle = () => {
    const trimmed = title.trim()
    if (!trimmed) return setTitle(task.title)
    if (trimmed !== task.title) save({ title: trimmed })
  }

  const done = task.status === 'completed'

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start gap-3 border-b p-4 pr-12">
        <div className="pt-2">
          <TaskCheckbox
            checked={done}
            disabled={readOnly || !canToggle || task.status === 'cancelled' || toggle.isPending}
            label={done ? 'Reopen task' : 'Complete task'}
            onToggle={() =>
              toggle.mutate(
                { task },
                {
                  onSuccess: () => toast.success(done ? 'Task reopened' : 'Task completed'),
                  onError: (error) => toast.error(error.message),
                },
              )
            }
          />
        </div>
        <div className="min-w-0 flex-1">
          <SheetTitle className="sr-only">{task.title}</SheetTitle>
          <SheetDescription className="sr-only">Task details and history</SheetDescription>
          <label htmlFor="task-title" className="sr-only">
            Title
          </label>
          <Input
            id="task-title"
            value={title}
            disabled={readOnly}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={saveTitle}
            onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
            className="h-auto border-transparent px-1.5 py-1 text-lg font-semibold shadow-none hover:border-input focus-visible:border-ring dark:bg-transparent"
          />
        </div>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        {archived ? (
          <p className="rounded-lg bg-warning/15 px-3 py-2 text-sm text-warning-foreground dark:text-warning">
            This task is archived and read-only. Restore it to make changes.
          </p>
        ) : readOnly ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            You can view this task, but not change it.
          </p>
        ) : null}

        {isOrganizationTask ? <TaskPeopleFields task={task} readOnly={archived} /> : null}

        <div className="space-y-3">
          <Field label="Status">
            <Select
              value={task.status}
              disabled={readOnly}
              onValueChange={(value) => save({ status: value as TaskStatus })}
            >
              <SelectTrigger className="w-full" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((status) => (
                  <SelectItem key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Priority">
            <Select
              value={task.priority}
              disabled={readOnly}
              onValueChange={(value) => save({ priority: value as TaskPriority })}
            >
              <SelectTrigger className="w-full" aria-label="Priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...TASK_PRIORITIES].reverse().map((priority) => (
                  <SelectItem key={priority} value={priority}>
                    {PRIORITY_LABELS[priority]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Deadline" htmlFor="task-due-date">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="task-due-date"
                type="date"
                value={dates.due_date}
                disabled={readOnly}
                onChange={(event) =>
                  save({
                    due_date: event.target.value || null,
                    due_time: event.target.value ? dates.due_time || null : null,
                  })
                }
                className="w-full max-w-44 min-w-0"
              />
              <Input
                type="time"
                aria-label="Deadline time (optional)"
                value={dates.due_time}
                disabled={readOnly || !dates.due_date}
                onChange={(event) =>
                  save({ due_date: dates.due_date, due_time: event.target.value || null })
                }
                className="w-full max-w-44 min-w-0"
              />
              {dates.due_date && !readOnly ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Clear deadline"
                  onClick={() => save({ due_date: null, due_time: null })}
                >
                  <XIcon />
                </Button>
              ) : null}
            </div>
          </Field>
          <Field label="Start date" htmlFor="task-start-date">
            <Input
              id="task-start-date"
              type="date"
              value={dates.start_date}
              disabled={readOnly}
              onChange={(event) => save({ start_date: event.target.value || null })}
              className="w-full max-w-44 min-w-0"
            />
          </Field>
          <Field label="Tags">
            <div className="flex flex-wrap items-center gap-1.5">
              {task.tags.map((tag) => (
                <TagChip
                  key={tag.id}
                  tag={tag}
                  onRemove={
                    readOnly
                      ? undefined
                      : () =>
                          save({
                            tag_ids: task.tags.filter((t) => t.id !== tag.id).map((t) => t.id),
                          })
                  }
                />
              ))}
              <TagPicker
                organizationId={task.organization_id}
                selected={task.tags}
                disabled={readOnly}
                onChange={(tag_ids) => save({ tag_ids })}
              />
            </div>
          </Field>
        </div>

        <Section title="Description">
          <label htmlFor="task-description" className="sr-only">
            Description
          </label>
          <Textarea
            id="task-description"
            value={description}
            disabled={readOnly}
            maxLength={10_000}
            placeholder="Add notes, links or context…"
            onChange={(event) => setDescription(event.target.value)}
            onBlur={() => {
              if (description !== (task.description ?? ''))
                save({ description: description || null })
            }}
            className="min-h-24"
          />
        </Section>

        <Section
          title={`Subtasks${task.subtask_count ? ` · ${task.subtasks_completed}/${task.subtask_count}` : ''}`}
        >
          <SubtaskList task={task} readOnly={readOnly} />
        </Section>

        <Section title="Activity">
          <ActivityTimeline taskId={task.id} />
        </Section>
      </div>

      <footer className="flex items-center justify-between gap-2 border-t p-4 empty:hidden">
        {!canArchive ? null : archived ? (
          <Button
            variant="outline"
            onClick={() =>
              action.mutate(
                { id: task.id, action: 'restore' },
                {
                  onSuccess: () => toast.success('Task restored'),
                  onError: (e) => toast.error(e.message),
                },
              )
            }
          >
            <ArchiveRestoreIcon data-icon="inline-start" />
            Restore
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={() =>
              action.mutate(
                { id: task.id, action: 'archive' },
                {
                  onSuccess: () => {
                    toast.success('Task archived', {
                      action: {
                        label: 'Undo',
                        onClick: () => action.mutate({ id: task.id, action: 'restore' }),
                      },
                    })
                    onClose()
                  },
                  onError: (e) => toast.error(e.message),
                },
              )
            }
          >
            <ArchiveIcon data-icon="inline-start" />
            Archive
          </Button>
        )}
        {/* Organization tasks are archived, never deleted (PRD: keep the audit trail). */}
        {isOrganizationTask ? null : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                <Trash2Icon data-icon="inline-start" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{task.title}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes the task
                  {task.subtask_count ? `, its ${task.subtask_count} subtask(s)` : ''} and its
                  history. This can't be undone. Archive it instead if you might need it later.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() =>
                    remove.mutate(task.id, {
                      onSuccess: () => {
                        toast.success('Task deleted')
                        onClose()
                      },
                      onError: (e) => toast.error(e.message),
                    })
                  }
                >
                  Delete permanently
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </footer>
    </div>
  )
}

interface TaskDetailSheetProps {
  taskId: number | null
  timezone: string
  onClose: () => void
}

/** Side panel for one task; its open state lives in the URL (?task=ID). */
export function TaskDetailSheet({ taskId, timezone, onClose }: TaskDetailSheetProps) {
  // Keep showing the last task while the panel slides closed, instead of a blank panel.
  const [lastId, setLastId] = useState(taskId)
  if (taskId !== null && taskId !== lastId) setLastId(taskId)
  const shownId = taskId ?? lastId
  const { data, isPending, isError, error, refetch } = useTask(shownId)

  return (
    <Sheet open={taskId !== null} onOpenChange={(open) => !open && onClose()}>
      {/* data-[side=right] overrides are required: the base sheet sets width via those selectors. */}
      <SheetContent
        side="right"
        className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
      >
        {shownId === null ? null : isPending ? (
          <div className="space-y-4 p-6">
            <SheetTitle className="sr-only">Loading task</SheetTitle>
            <SheetDescription className="sr-only">Loading</SheetDescription>
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : isError ? (
          <div className="p-6">
            <SheetTitle className="sr-only">Task unavailable</SheetTitle>
            <SheetDescription className="sr-only">The task could not be loaded</SheetDescription>
            <ErrorState
              title={
                error instanceof ApiError && error.status === 404
                  ? 'Task not found'
                  : "Couldn't load task"
              }
              message={
                error instanceof ApiError && error.status === 404
                  ? 'It may have been deleted.'
                  : (error?.message ?? 'Please try again.')
              }
              onRetry={() => void refetch()}
            />
          </div>
        ) : (
          <TaskEditor key={data.id} task={data} timezone={timezone} onClose={onClose} />
        )}
      </SheetContent>
    </Sheet>
  )
}
