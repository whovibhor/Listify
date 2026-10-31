import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CheckIcon,
  EllipsisIcon,
  LinkIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
} from 'lucide-react'
import { motion } from 'motion/react'
import { Link, NavLink, Navigate, useLocation, useNavigate, useParams } from 'react-router'
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
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useMe } from '@/features/auth/api'
import { useAttachments, useComments, useUpdateRequests } from '@/features/collaboration/api'
import { TaskAttachments } from '@/features/collaboration/components/TaskAttachments'
import { TaskComments } from '@/features/collaboration/components/TaskComments'
import { TaskUpdateRequests } from '@/features/collaboration/components/TaskUpdateRequests'
import { useMyOrganizations } from '@/features/organizations/api'
import { BackLink } from '@/features/reports/components/ReportParts'
import {
  useDeleteTask,
  useTask,
  useTaskAction,
  useToggleComplete,
  useUpdateTask,
} from '@/features/tasks/api'
import { ActivityTimeline } from '@/features/tasks/components/ActivityTimeline'
import { SubtaskList } from '@/features/tasks/components/SubtaskList'
import { TaskStatusBadge } from '@/features/tasks/components/TaskBadges'
import { TaskDetailsRail } from '@/features/tasks/components/TaskDetailsRail'
import { TaskEditDialog } from '@/features/tasks/components/TaskEditDialog'
import { canEditTask } from '@/features/tasks/task-permissions'
import { STATUS_LABELS, type TaskStatus } from '@/features/tasks/task-meta'
import { taskPath, type TaskTab } from '@/features/tasks/task-path'
import type { TaskDetail } from '@/features/tasks/types'
import { ApiError, errorText } from '@/lib/api-client'
import { pageEnter } from '@/lib/motion'
import { cn } from '@/lib/utils'

// Personal tasks never require review, so "In review" isn't offered here (ADR-015).
const PERSONAL_STATUSES: TaskStatus[] = [
  'not_started',
  'in_progress',
  'blocked',
  'completed',
  'cancelled',
]

const COMMENT_PREVIEW = 3

function useBackTo(task: TaskDetail) {
  const { state } = useLocation()
  const from = (state as { from?: string } | null)?.from
  if (from) return from
  if (task.parent_task_id) return taskPath({ ...task, id: task.parent_task_id })
  return task.organization_id ? `/org/${task.organization_id}/tasks` : '/personal/tasks'
}

function ParentLink({ task }: { task: TaskDetail }) {
  const { data: parent } = useTask(task.parent_task_id)
  if (!parent) return null
  return (
    <p className="text-sm text-muted-foreground">
      Subtask of{' '}
      <Link
        to={taskPath(parent)}
        className="font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {parent.title}
      </Link>
    </p>
  )
}

function StatusControl({ task, readOnly }: { task: TaskDetail; readOnly: boolean }) {
  const update = useUpdateTask(task.id)
  const statuses =
    task.organization_id === null ? PERSONAL_STATUSES : [task.status, ...task.allowed_statuses]

  if (readOnly || statuses.length < 2) return <TaskStatusBadge status={task.status} />
  return (
    <Select
      value={task.status}
      disabled={update.isPending}
      onValueChange={(value) =>
        update.mutate(
          { status: value as TaskStatus },
          { onError: (error) => toast.error(errorText(error)) },
        )
      }
    >
      <SelectTrigger className="w-36" aria-label="Status">
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
  )
}

function MoreActions({ task }: { task: TaskDetail }) {
  const navigate = useNavigate()
  const back = useBackTo(task)
  const action = useTaskAction()
  const remove = useDeleteTask()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const isOrganizationTask = task.organization_id !== null
  const isSubtask = task.parent_task_id !== null
  const archived = task.archived_at !== null
  const canArchive = !isSubtask && (!isOrganizationTask || task.actions.includes('archive'))
  // Organization tasks are archived, never deleted (PRD: keep the audit trail).
  const canDelete = !isOrganizationTask || (isSubtask && task.actions.includes('edit'))

  const copyLink = () => {
    void navigator.clipboard
      .writeText(`${window.location.origin}${taskPath(task)}`)
      .then(() => toast.success('Link copied'))
  }

  const archive = () =>
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
          void navigate(back)
        },
        onError: (error) => toast.error(error.message),
      },
    )

  const restore = () =>
    action.mutate(
      { id: task.id, action: 'restore' },
      {
        onSuccess: () => toast.success('Task restored'),
        onError: (error) => toast.error(error.message),
      },
    )

  const deleteTask = () =>
    remove.mutate(task.id, {
      onSuccess: () => {
        toast.success('Task deleted')
        void navigate(back)
      },
      onError: (error) => toast.error(error.message),
    })

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="More actions">
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={copyLink}>
            <LinkIcon aria-hidden />
            Copy link
          </DropdownMenuItem>
          {canArchive && !archived ? (
            <DropdownMenuItem onSelect={archive}>
              <ArchiveIcon aria-hidden />
              Archive
            </DropdownMenuItem>
          ) : null}
          {canArchive && archived ? (
            <DropdownMenuItem onSelect={restore}>
              <ArchiveRestoreIcon aria-hidden />
              Restore
            </DropdownMenuItem>
          ) : null}
          {canDelete ? (
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmingDelete(true)}>
              <Trash2Icon aria-hidden />
              Delete
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{task.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the task
              {task.subtask_count ? `, its ${task.subtask_count} subtask(s)` : ''} and its history.
              This can't be undone.
              {canArchive ? ' Archive it instead if you might need it later.' : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={deleteTask}>
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function CompleteButton({ task }: { task: TaskDetail }) {
  const toggle = useToggleComplete()
  const done = task.status === 'completed'
  const allowed =
    task.organization_id === null ||
    task.allowed_statuses.includes(done ? 'in_progress' : 'completed')
  if (!allowed || task.status === 'cancelled') return null
  return (
    <Button
      variant={done ? 'outline' : 'default'}
      disabled={toggle.isPending}
      onClick={() =>
        toggle.mutate(
          { task },
          {
            onSuccess: () => toast.success(done ? 'Task reopened' : 'Task completed'),
            onError: (error) => toast.error(error.message),
          },
        )
      }
    >
      {done ? <RotateCcwIcon data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
      {done ? 'Reopen' : 'Complete'}
    </Button>
  )
}

function LatestComments({ task }: { task: TaskDetail }) {
  const { data = [], isPending } = useComments(task.id)
  const comments = data
    .filter((comment) => !comment.deleted)
    .slice(-COMMENT_PREVIEW)
    .reverse()
  if (isPending) return <Skeleton className="h-16 w-full" />
  if (comments.length === 0) {
    return <p className="text-sm text-muted-foreground">No comments yet.</p>
  }
  return (
    <ul className="space-y-3">
      {comments.map((comment) => (
        <li key={comment.id} className="text-sm">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{comment.author.name}</span>
            <time dateTime={comment.created_at} className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
            </time>
          </p>
          <p className="line-clamp-2 wrap-anywhere whitespace-pre-wrap text-muted-foreground">
            {comment.body}
          </p>
        </li>
      ))}
    </ul>
  )
}

function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3 rounded-2xl bg-card p-4 shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Overview({ task, readOnly }: { task: TaskDetail; readOnly: boolean }) {
  const { state } = useLocation()
  const isSubtask = task.parent_task_id !== null
  return (
    <div className="space-y-4">
      <Section title="Description">
        {task.description ? (
          <p className="text-sm wrap-anywhere whitespace-pre-wrap">{task.description}</p>
        ) : (
          <p className="text-sm text-muted-foreground">No description yet.</p>
        )}
      </Section>
      {isSubtask ? null : (
        <Section
          title={`Subtasks${task.subtask_count ? ` · ${task.subtasks_completed}/${task.subtask_count}` : ''}`}
        >
          <SubtaskList task={task} readOnly={readOnly} />
        </Section>
      )}
      {isSubtask ? null : (
        <Section
          title="Latest comments"
          action={
            <Link
              to={taskPath(task, 'comments')}
              state={state}
              className="text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              All comments
            </Link>
          }
        >
          <LatestComments task={task} />
        </Section>
      )}
    </div>
  )
}

function TaskView({ task, tab, timezone }: { task: TaskDetail; tab?: string; timezone: string }) {
  const { state } = useLocation()
  const back = useBackTo(task)
  const [editing, setEditing] = useState(false)
  const isOrganizationTask = task.organization_id !== null
  // Comments, files and update requests belong to the top-level task, on the server too.
  const collaborative = task.parent_task_id === null
  const archived = task.archived_at !== null
  const readOnly = archived || (isOrganizationTask && !task.actions.includes('edit'))
  const { data: comments = [] } = useComments(task.id, { enabled: collaborative })
  const { data: files = [] } = useAttachments(task.id, { enabled: collaborative })
  const { data: requests = [] } = useUpdateRequests(task.id, {
    enabled: collaborative && isOrganizationTask,
  })

  const tabs: { value?: TaskTab; label: string; count?: number }[] = [
    { label: 'Overview' },
    ...(collaborative
      ? [
          {
            value: 'comments' as const,
            label: 'Comments',
            count: comments.filter((comment) => !comment.deleted).length,
          },
          { value: 'files' as const, label: 'Files', count: files.length },
        ]
      : []),
    ...(collaborative && isOrganizationTask
      ? [
          {
            value: 'requests' as const,
            label: 'Update requests',
            count: requests.filter((request) => request.status === 'pending').length,
          },
        ]
      : []),
    { value: 'activity', label: 'Activity' },
  ]

  if (tab && !tabs.some((option) => option.value === tab)) {
    return <Navigate to={taskPath(task)} state={state} replace />
  }

  return (
    <motion.div {...pageEnter} className="space-y-5">
      <BackLink to={back}>Back</BackLink>
      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1">
          {task.parent_task_id ? <ParentLink task={task} /> : null}
          <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">{task.title}</h1>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <StatusControl task={task} readOnly={readOnly} />
          {archived ? null : <CompleteButton task={task} />}
          {canEditTask(task) ? (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <PencilIcon data-icon="inline-start" />
              Edit
            </Button>
          ) : null}
          <MoreActions task={task} />
        </div>
      </header>

      {archived ? (
        <p className="rounded-lg bg-warning/15 px-3 py-2 text-sm text-warning-foreground dark:text-warning">
          This task is archived and read-only. Restore it to make changes.
        </p>
      ) : !canEditTask(task) ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          You can view this task, but not change it.
        </p>
      ) : null}
      {task.needs_reassignment ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {task.assignee?.name} can no longer work on this task. Choose someone else.
        </p>
      ) : null}

      {/* The rail comes first in the page, so phones read the facts before the tabs. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <div className="lg:order-last">
          <TaskDetailsRail task={task} timezone={timezone} />
        </div>
        <div className="min-w-0 space-y-4">
          <nav aria-label="Task sections" className="flex gap-1 overflow-x-auto border-b">
            {tabs.map((option) => (
              <NavLink
                key={option.label}
                to={taskPath(task, option.value)}
                state={state}
                end
                aria-label={option.count ? `${option.label}, ${option.count}` : undefined}
                className={({ isActive }) =>
                  cn(
                    '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-(--duration-fast) outline-none',
                    'focus-visible:ring-3 focus-visible:ring-ring/50',
                    isActive
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {option.label}
                {option.count ? (
                  <span className="text-xs text-muted-foreground tabular-nums">{option.count}</span>
                ) : null}
              </NavLink>
            ))}
          </nav>
          {tab === 'comments' ? (
            <Section title="Comments">
              <TaskComments task={task} readOnly={archived} />
            </Section>
          ) : tab === 'files' ? (
            <Section title="Files">
              <TaskAttachments taskId={task.id} canUpload={!readOnly} />
            </Section>
          ) : tab === 'requests' ? (
            <Section title="Update requests">
              <TaskUpdateRequests task={task} readOnly={archived} />
            </Section>
          ) : tab === 'activity' ? (
            <Section title="Activity">
              <ActivityTimeline taskId={task.id} />
            </Section>
          ) : (
            <Overview task={task} readOnly={readOnly} />
          )}
        </div>
      </div>
      {editing ? (
        <TaskEditDialog task={task} timezone={timezone} onClose={() => setEditing(false)} />
      ) : null}
    </motion.div>
  )
}

/** One task in full, at its own address in Personal or in an organization. */
export function TaskPage() {
  const params = useParams()
  const { pathname, state } = useLocation()
  const { data: task, isPending, error, refetch } = useTask(Number(params.taskId))
  const { data: user } = useMe()
  const { data: organizations } = useMyOrganizations()

  if (isPending) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Loading task">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    )
  }
  if (!task) {
    const missing = error instanceof ApiError && error.status === 404
    return (
      <ErrorState
        title={missing ? 'Task not found' : "Couldn't load task"}
        message={
          missing
            ? 'It may have been deleted, or you may not have access to it.'
            : (error?.message ?? 'Please try again.')
        }
        onRetry={() => void refetch()}
      />
    )
  }
  // A link can name the wrong workspace: a task only lives in one.
  if (!pathname.startsWith(taskPath(task)))
    return <Navigate to={taskPath(task)} state={state} replace />

  const organization = organizations?.find((candidate) => candidate.id === task.organization_id)
  return (
    <TaskView
      key={task.id}
      task={task}
      tab={params.tab}
      timezone={organization?.timezone ?? user?.timezone ?? 'UTC'}
    />
  )
}
