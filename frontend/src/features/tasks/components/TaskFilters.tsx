import { useEffect, useState, type ReactNode } from 'react'
import { AlarmClockIcon, ArrowUpDownIcon, ChevronDownIcon, SearchIcon, XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useTags } from '@/features/tasks/api'
import { TAG_COLOR_CLASSES } from '@/features/tasks/tag-colors'
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_PRIORITIES,
  type TaskStatus,
} from '@/features/tasks/task-meta'
import type { TaskSort } from '@/features/tasks/types'
import type { useTaskSearchParams } from '@/features/tasks/use-task-search-params'
import { cn } from '@/lib/utils'

const SORT_LABELS: Partial<Record<TaskSort, string>> = {
  due: 'Deadline (soonest)',
  '-due': 'Deadline (latest)',
  priority: 'Priority (highest)',
  '-created': 'Newest first',
  created: 'Oldest first',
  title: 'Title (A–Z)',
  completed: 'Recently completed',
}

interface TaskFiltersProps {
  search: ReturnType<typeof useTaskSearchParams>
  statuses: readonly TaskStatus[]
  sorts: TaskSort[]
  defaultSort: TaskSort
  showOverdue?: boolean
  /** Organization views use that organization's tags. */
  organizationId?: number
  extra?: ReactNode
}

function FilterButton({
  label,
  count,
  children,
}: {
  label: string
  count: number
  children: ReactNode
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(count > 0 && 'border-primary/40 bg-accent/60')}
        >
          {label}
          {count > 0 ? (
            <span className="rounded-sm bg-primary px-1 text-[0.65rem] text-primary-foreground tabular-nums">
              {count}
            </span>
          ) : null}
          <ChevronDownIcon data-icon="inline-end" className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

export function TaskFilters({
  search,
  statuses,
  sorts,
  defaultSort,
  showOverdue = true,
  organizationId,
  extra,
}: TaskFiltersProps) {
  const { filters, update, clearFilters, activeFilterCount } = search
  const { data: tags = [] } = useTags(organizationId)
  const [q, setQ] = useState(filters.q)

  // Debounce typing into the URL (and thus the API).
  useEffect(() => {
    if (q === filters.q) return
    const timer = window.setTimeout(() => update({ q: q.trim() || null }), 300)
    return () => window.clearTimeout(timer)
  }, [q, filters.q, update])

  return (
    <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Filter tasks">
      <div className="relative w-full sm:w-56">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search tasks"
          aria-label="Search tasks by title"
          maxLength={100}
          className="pl-8"
        />
      </div>

      {statuses.length > 1 ? (
        <FilterButton label="Status" count={filters.status.length}>
          <DropdownMenuLabel>Status</DropdownMenuLabel>
          {statuses.map((status) => (
            <DropdownMenuCheckboxItem
              key={status}
              checked={filters.status.includes(status)}
              onCheckedChange={() => update({ status: toggle(filters.status, status) })}
              onSelect={(event) => event.preventDefault()}
            >
              {STATUS_LABELS[status]}
            </DropdownMenuCheckboxItem>
          ))}
        </FilterButton>
      ) : null}

      <FilterButton label="Priority" count={filters.priority.length}>
        <DropdownMenuLabel>Priority</DropdownMenuLabel>
        {[...TASK_PRIORITIES].reverse().map((priority) => (
          <DropdownMenuCheckboxItem
            key={priority}
            checked={filters.priority.includes(priority)}
            onCheckedChange={() => update({ priority: toggle(filters.priority, priority) })}
            onSelect={(event) => event.preventDefault()}
          >
            {PRIORITY_LABELS[priority]}
          </DropdownMenuCheckboxItem>
        ))}
      </FilterButton>

      <FilterButton label="Tags" count={filters.tag.length}>
        <DropdownMenuLabel>Tags</DropdownMenuLabel>
        {tags.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            No tags yet. Add them from a task.
          </p>
        ) : (
          tags.map((tag) => (
            <DropdownMenuCheckboxItem
              key={tag.id}
              checked={filters.tag.includes(tag.id)}
              onCheckedChange={() => update({ tag: toggle(filters.tag, tag.id).map(String) })}
              onSelect={(event) => event.preventDefault()}
            >
              <span
                aria-hidden
                className={cn('size-2 rounded-full', TAG_COLOR_CLASSES[tag.color].dot)}
              />
              {tag.name}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </FilterButton>

      {showOverdue ? (
        <Button
          variant="outline"
          size="sm"
          aria-pressed={filters.overdue}
          onClick={() => update({ overdue: filters.overdue ? null : 'true' })}
          className={cn(
            filters.overdue && 'border-destructive/40 bg-destructive/10 text-destructive',
          )}
        >
          <AlarmClockIcon data-icon="inline-start" />
          Overdue
        </Button>
      ) : null}

      {extra}

      <div className="ml-auto flex items-center gap-2">
        {activeFilterCount > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ('')
              clearFilters()
            }}
          >
            <XIcon data-icon="inline-start" />
            Clear
          </Button>
        ) : null}
        {sorts.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Sort tasks">
                <ArrowUpDownIcon data-icon="inline-start" />
                <span className="hidden sm:inline">{SORT_LABELS[filters.sort ?? defaultSort]}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={filters.sort ?? defaultSort}
                onValueChange={(value) => update({ sort: value === defaultSort ? null : value })}
              >
                {sorts.map((sort) => (
                  <DropdownMenuRadioItem key={sort} value={sort}>
                    {SORT_LABELS[sort]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  )
}
