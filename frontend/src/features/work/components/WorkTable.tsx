import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  TriangleAlertIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DueChip } from '@/features/tasks/components/DueChip'
import { TaskPriorityBadge, TaskStatusBadge } from '@/features/tasks/components/TaskBadges'
import type { Page, Task, TaskSort } from '@/features/tasks/types'
import { MemberAvatar } from '@/features/organizations/components/MemberAvatar'
import { cn } from '@/lib/utils'

interface WorkTableProps {
  page: Page<Task>
  timezone: string
  sort: TaskSort
  showDepartment?: boolean
  onSort: (sort: TaskSort) => void
  onOpen: (id: number) => void
  onPageChange: (page: number) => void
}

function SortHeader({
  label,
  ascending,
  descending,
  sort,
  onSort,
  className,
}: {
  label: string
  ascending: TaskSort
  descending: TaskSort
  sort: TaskSort
  onSort: (sort: TaskSort) => void
  className?: string
}) {
  const active = sort === ascending || sort === descending
  const Icon = sort === descending ? ArrowDownIcon : ArrowUpIcon
  return (
    <th
      scope="col"
      aria-sort={active ? (sort === ascending ? 'ascending' : 'descending') : 'none'}
      className={cn('px-3 py-2 text-left font-medium', className)}
    >
      <button
        type="button"
        onClick={() => onSort(sort === ascending ? descending : ascending)}
        className="inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {label}
        {active ? <Icon aria-hidden className="size-3.5" /> : null}
      </button>
    </th>
  )
}

export function WorkTable({
  page,
  timezone,
  sort,
  showDepartment,
  onSort,
  onOpen,
  onPageChange,
}: WorkTableProps) {
  const pageCount = Math.max(1, Math.ceil(page.total / page.page_size))
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl bg-card shadow-card">
        <table className="w-full table-fixed text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <SortHeader
                label="Task"
                ascending="title"
                descending="title"
                sort={sort}
                onSort={onSort}
              />
              <th scope="col" className="hidden w-32 px-3 py-2 text-left font-medium sm:table-cell">
                Status
              </th>
              <SortHeader
                label="Priority"
                ascending="-priority"
                descending="priority"
                sort={sort}
                onSort={onSort}
                className="hidden w-28 lg:table-cell"
              />
              <th scope="col" className="hidden w-40 px-3 py-2 text-left font-medium md:table-cell">
                Assignee
              </th>
              {showDepartment ? (
                <th
                  scope="col"
                  className="hidden w-36 px-3 py-2 text-left font-medium xl:table-cell"
                >
                  Department
                </th>
              ) : null}
              <SortHeader
                label="Deadline"
                ascending="due"
                descending="-due"
                sort={sort}
                onSort={onSort}
                className="hidden w-40 md:table-cell"
              />
            </tr>
          </thead>
          <tbody>
            {page.items.map((task) => (
              <tr
                key={task.id}
                className="relative transition-colors duration-(--duration-fast) odd:bg-muted/40 hover:bg-accent/50"
              >
                <td className="min-w-0 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => onOpen(task.id)}
                    className="block w-full truncate text-left font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
                  >
                    {task.title}
                  </button>
                  {task.needs_reassignment ? (
                    <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-destructive">
                      <TriangleAlertIcon aria-hidden className="size-3.5 shrink-0" />
                      Needs reassignment
                    </span>
                  ) : null}
                  {/* Phones have no room for columns: the same facts sit under the title. */}
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 md:hidden">
                    <TaskStatusBadge status={task.status} className="sm:hidden" />
                    <DueChip task={task} timezone={timezone} />
                    <span className="text-xs text-muted-foreground">
                      {task.assignee?.name ?? 'Unassigned'}
                    </span>
                  </span>
                </td>
                <td className="hidden px-3 py-2.5 sm:table-cell">
                  <TaskStatusBadge status={task.status} />
                </td>
                <td className="hidden px-3 py-2.5 lg:table-cell">
                  <TaskPriorityBadge priority={task.priority} />
                </td>
                <td className="hidden px-3 py-2.5 md:table-cell">
                  {task.assignee ? (
                    <span className="flex min-w-0 items-center gap-1.5">
                      <MemberAvatar name={task.assignee.name} className="size-5 text-[0.6rem]" />
                      <span className="truncate">{task.assignee.name}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Unassigned</span>
                  )}
                </td>
                {showDepartment ? (
                  <td className="hidden truncate px-3 py-2.5 text-muted-foreground xl:table-cell">
                    {task.department?.name ?? '—'}
                  </td>
                ) : null}
                <td className="hidden px-3 py-2.5 md:table-cell">
                  <DueChip task={task} timezone={timezone} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageCount > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground tabular-nums">
            Page {page.page} of {pageCount}
          </p>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page.page <= 1}
              onClick={() => onPageChange(page.page - 1)}
            >
              <ChevronLeftIcon data-icon="inline-start" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page.page >= pageCount}
              onClick={() => onPageChange(page.page + 1)}
            >
              Next
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  )
}
