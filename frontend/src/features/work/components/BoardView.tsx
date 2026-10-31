import { useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  ArrowRightLeftIcon,
  GripVerticalIcon,
  ListChecksIcon,
  TriangleAlertIcon,
  UsersRoundIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DueChip } from '@/features/tasks/components/DueChip'
import { TagChip } from '@/features/tasks/components/TagChip'
import { TaskPriorityBadge, TaskStatusBadge } from '@/features/tasks/components/TaskBadges'
import { STATUS_LABELS, type TaskStatus } from '@/features/tasks/task-meta'
import type { Task } from '@/features/tasks/types'
import { useMoveOnBoard, type WorkParams } from '@/features/work/api'
import { MemberAvatar } from '@/features/organizations/components/MemberAvatar'
import type { Board } from '@/features/work/types'
import { errorText } from '@/lib/api-client'
import { cn } from '@/lib/utils'

// Work moves left to right; Blocked and Cancelled sit outside that flow, at the end if shown.
const COLUMN_ORDER: TaskStatus[] = [
  'not_started',
  'in_progress',
  'in_review',
  'completed',
  'blocked',
  'cancelled',
]

/** Matches BOARD_COMPLETED_DAYS on the server. */
const COMPLETED_DAYS = 30

interface CardProps {
  task: Task
  timezone: string
  onOpen: (id: number) => void
  onMove: (task: Task, status: TaskStatus) => void
}

function CardBody({ task, timezone }: Pick<CardProps, 'task' | 'timezone'>) {
  return (
    <>
      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        {task.priority !== 'medium' ? <TaskPriorityBadge priority={task.priority} /> : null}
        <DueChip task={task} timezone={timezone} />
        {task.tags.map((tag) => (
          <TagChip key={tag.id} tag={tag} />
        ))}
      </span>
      {task.needs_reassignment ? (
        <span className="mt-1.5 flex items-center gap-1 text-xs font-medium text-destructive">
          <TriangleAlertIcon aria-hidden className="size-3.5 shrink-0" />
          Needs reassignment
        </span>
      ) : null}
      <span className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          {task.assignee ? (
            <>
              <MemberAvatar name={task.assignee.name} className="size-5 text-[0.6rem]" />
              <span className="truncate">{task.assignee.name}</span>
            </>
          ) : (
            <span>Unassigned</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2 tabular-nums">
          {task.collaborators.length > 0 ? (
            <span className="inline-flex items-center gap-1">
              <UsersRoundIcon aria-hidden className="size-3.5" />
              <span className="sr-only">Collaborators: </span>
              {task.collaborators.length}
            </span>
          ) : null}
          {task.subtask_count > 0 ? (
            <span className="inline-flex items-center gap-1">
              <ListChecksIcon aria-hidden className="size-3.5" />
              <span className="sr-only">Subtasks completed: </span>
              {task.subtasks_completed}/{task.subtask_count}
            </span>
          ) : null}
        </span>
      </span>
    </>
  )
}

function TaskCard({ task, timezone, onOpen, onMove }: CardProps) {
  const movable = task.allowed_statuses.length > 0
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    disabled: !movable,
  })

  return (
    <li
      ref={setNodeRef}
      {...listeners}
      className={cn(
        'relative rounded-xl bg-card p-3 shadow-card transition-shadow duration-(--duration-fast) hover:shadow-raised',
        movable && 'cursor-grab touch-pan-y',
        isDragging && 'opacity-40',
      )}
    >
      <div className="flex items-start gap-1">
        <button
          type="button"
          onClick={() => onOpen(task.id)}
          className="min-w-0 flex-1 text-left text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
        >
          <span className="line-clamp-2">{task.title}</span>
        </button>
        {movable ? (
          <span className="relative z-10 flex shrink-0 items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move “${task.title}” to another column`}
                >
                  <ArrowRightLeftIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>Move to</DropdownMenuLabel>
                {task.allowed_statuses.map((status) => (
                  <DropdownMenuItem key={status} onSelect={() => onMove(task, status)}>
                    {STATUS_LABELS[status]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              aria-label={`Drag “${task.title}”`}
              className="grid size-7 cursor-grab place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <GripVerticalIcon aria-hidden className="size-4" />
            </button>
          </span>
        ) : null}
      </div>
      <CardBody task={task} timezone={timezone} />
    </li>
  )
}

function BoardColumn({
  column,
  dragged,
  onShowOlder,
  children,
}: {
  column: Board['columns'][number]
  dragged: Task | null
  onShowOlder: () => void
  children: React.ReactNode
}) {
  const accepts = dragged?.allowed_statuses.includes(column.status) ?? false
  const { setNodeRef, isOver } = useDroppable({ id: column.status, disabled: !accepts })
  const hiddenCount = column.total - column.items.length
  return (
    <section
      ref={setNodeRef}
      aria-label={`${STATUS_LABELS[column.status]}, ${column.total} tasks`}
      data-testid={`column-${column.status}`}
      className={cn(
        'flex w-72 shrink-0 snap-start flex-col gap-2 rounded-2xl bg-muted/60 p-2 transition-colors duration-(--duration-fast)',
        dragged && !accepts && 'opacity-50',
        accepts && 'bg-accent/50',
        isOver && 'bg-accent ring-2 ring-primary/40',
      )}
    >
      <header className="flex items-center justify-between gap-2 px-1 pt-1">
        <TaskStatusBadge status={column.status} />
        <span className="text-xs text-muted-foreground tabular-nums">{column.total}</span>
      </header>
      <ul className="min-h-16 space-y-2">{children}</ul>
      {hiddenCount > 0 ? (
        <p className="px-1 pb-1 text-xs text-muted-foreground">
          {hiddenCount} more in the List view
        </p>
      ) : null}
      {column.status === 'completed' ? (
        <p className="px-1 pb-1 text-xs text-muted-foreground">
          Last {COMPLETED_DAYS} days.{' '}
          {column.older ? (
            <button
              type="button"
              onClick={onShowOlder}
              className="font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {column.older} older in the List view
            </button>
          ) : null}
        </p>
      ) : null}
    </section>
  )
}

interface BoardViewProps {
  organizationId: number
  board: Board
  params: WorkParams
  timezone: string
  onOpen: (id: number) => void
  /** Columns switched off; cards can still be moved to them from the Move menu. */
  hidden: TaskStatus[]
  onShowColumn: (status: TaskStatus) => void
  onShowOlder: () => void
}

export function BoardView({
  organizationId,
  board,
  params,
  timezone,
  onOpen,
  hidden,
  onShowColumn,
  onShowOlder,
}: BoardViewProps) {
  const [dragged, setDragged] = useState<Task | null>(null)
  const move = useMoveOnBoard(organizationId, board.department.id, params)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // A short hold on touch, so a swipe still scrolls the board sideways.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const moveTask = (task: Task, status: TaskStatus) =>
    move.mutate(
      { task, status },
      {
        onSuccess: () =>
          toast.success(
            `Moved to ${STATUS_LABELS[status]}`,
            // Otherwise a card moved to a hidden column just seems to vanish.
            hidden.includes(status)
              ? { action: { label: 'Show column', onClick: () => onShowColumn(status) } }
              : undefined,
          ),
        onError: (error) => toast.error(errorText(error)),
      },
    )

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragged(null)
    const task = active.data.current?.task as Task | undefined
    const status = over?.id as TaskStatus | undefined
    if (task && status && status !== task.status) moveTask(task, status)
  }

  const columns = COLUMN_ORDER.filter((status) => !hidden.includes(status))
    .flatMap((status) => board.columns.filter((column) => column.status === status))
    // In Review only exists where the organization turned review on (ADR-015).
    .filter((column) => column.status !== 'in_review' || board.review_required || column.total > 0)

  return (
    <DndContext
      sensors={sensors}
      onDragStart={({ active }) => setDragged((active.data.current?.task as Task) ?? null)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragged(null)}
    >
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0">
        {columns.map((column) => (
          <BoardColumn
            key={column.status}
            column={column}
            dragged={dragged}
            onShowOlder={onShowOlder}
          >
            {column.items.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                timezone={timezone}
                onOpen={onOpen}
                onMove={moveTask}
              />
            ))}
          </BoardColumn>
        ))}
      </div>
      <DragOverlay>
        {dragged ? (
          <div className="w-68 rotate-1 cursor-grabbing rounded-xl bg-card p-3 shadow-raised">
            <p className="line-clamp-2 text-sm font-medium">{dragged.title}</p>
            <CardBody task={dragged} timezone={timezone} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
