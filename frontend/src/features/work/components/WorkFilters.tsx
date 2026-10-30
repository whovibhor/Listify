import { useState } from 'react'

import { NativeSelect } from '@/components/shared/NativeSelect'
import { Input } from '@/components/ui/input'
import { useMembers } from '@/features/organizations/api'
import { TaskFilters } from '@/features/tasks/components/TaskFilters'
import { TASK_STATUSES } from '@/features/tasks/task-meta'
import type { TaskSort } from '@/features/tasks/types'
import type { useTaskSearchParams } from '@/features/tasks/use-task-search-params'
import { UNASSIGNED } from '@/features/work/work-params'

const SORTS: TaskSort[] = ['due', '-due', 'priority', '-created', 'created', 'title']

interface WorkFiltersProps {
  organizationId: number
  search: ReturnType<typeof useTaskSearchParams>
  departmentId?: number
  /** The board's columns already show status, so it has no sort or status filter. */
  showSort?: boolean
  showDueRange?: boolean
}

export function WorkFilters({
  organizationId,
  search,
  departmentId,
  showSort = true,
  showDueRange = true,
}: WorkFiltersProps) {
  const { filters, update } = search
  const [expanded, setExpanded] = useState(false)
  const { data } = useMembers(organizationId, {
    department_id: departmentId,
    status: 'active',
    page_size: 100,
  })
  const people = data?.items ?? []

  return (
    <div className="space-y-2">
      <TaskFilters
        search={search}
        organizationId={organizationId}
        statuses={showSort ? TASK_STATUSES : []}
        sorts={showSort ? SORTS : []}
        defaultSort="due"
        extra={
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            className="text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {expanded ? 'Fewer filters' : 'More filters'}
          </button>
        }
      />
      {expanded || filters.assignee || filters.creator || filters.due_from || filters.due_to ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <NativeSelect
            aria-label="Filter by assignee"
            value={filters.assignee}
            onChange={(event) => update({ assignee: event.target.value || null })}
          >
            <option value="">Any assignee</option>
            <option value={UNASSIGNED}>Unassigned</option>
            {people.map((person) => (
              <option key={person.user_id} value={person.user_id}>
                {person.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Filter by creator"
            value={filters.creator}
            onChange={(event) => update({ creator: event.target.value || null })}
          >
            <option value="">Any creator</option>
            {people.map((person) => (
              <option key={person.user_id} value={person.user_id}>
                {person.name}
              </option>
            ))}
          </NativeSelect>
          {showDueRange ? (
            <>
              <Input
                type="date"
                aria-label="Deadline from"
                value={filters.due_from}
                onChange={(event) => update({ due_from: event.target.value || null })}
              />
              <Input
                type="date"
                aria-label="Deadline to"
                value={filters.due_to}
                onChange={(event) => update({ due_to: event.target.value || null })}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
