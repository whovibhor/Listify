import { useState } from 'react'
import { ListTodoIcon, PlusIcon, TriangleAlertIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useSearchParams } from 'react-router'

import { NativeSelect } from '@/components/shared/NativeSelect'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState, ErrorState } from '@/components/shared/StatePanels'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useDepartments } from '@/features/organizations/api'
import { useOrg } from '@/features/organizations/use-current-org'
import { TaskDetailSheet } from '@/features/tasks/components/TaskDetailSheet'
import { useTaskSearchParams } from '@/features/tasks/use-task-search-params'
import { useOrganizationTasks } from '@/features/work/api'
import { CreateTaskDialog } from '@/features/work/components/CreateTaskDialog'
import { WorkFilters } from '@/features/work/components/WorkFilters'
import { WorkTable } from '@/features/work/components/WorkTable'
import { workParams } from '@/features/work/work-params'
import { pageEnter } from '@/lib/motion'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 25

/** Active work the viewer can see, and search across everything. Same rules as the boards. */
export function TeamTasksPage() {
  const org = useOrg()
  const search = useTaskSearchParams()
  const { filters, update, openTaskId, openTask, activeFilterCount } = search
  const [params] = useSearchParams()
  const [creating, setCreating] = useState(false)
  const { data: departments = [] } = useDepartments(org.id)
  const departmentId = params.get('department')
  const flagged = params.get('flagged') === 'true'
  const archived = params.get('archived') === 'true'
  const showFinished = params.get('finished') === 'true'

  const { data, isPending, isError, error, refetch } = useOrganizationTasks(org.id, {
    ...workParams(search),
    view: archived ? 'archived' : 'team',
    // Searching still finds finished work.
    active: !archived && !showFinished && !filters.q,
    department_id: departmentId ? Number(departmentId) : undefined,
    needs_reassignment: flagged || undefined,
    sort: filters.sort,
    page: filters.page,
    page_size: PAGE_SIZE,
  })

  return (
    <motion.div {...pageEnter} className="space-y-4">
      <PageHeader
        title="Team Tasks"
        description={
          showFinished
            ? 'Everything you can see in this organization.'
            : 'Active work you can see in this organization.'
        }
        actions={
          <Button onClick={() => setCreating(true)}>
            <PlusIcon data-icon="inline-start" />
            New task
          </Button>
        }
      />
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-56">
            <NativeSelect
              aria-label="Filter by department"
              value={departmentId ?? ''}
              onChange={(event) => update({ department: event.target.value || null })}
            >
              <option value="">All departments</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={flagged}
            onClick={() => update({ flagged: flagged ? null : 'true' })}
            className={cn(flagged && 'border-destructive/40 bg-destructive/10 text-destructive')}
          >
            <TriangleAlertIcon data-icon="inline-start" />
            Needs reassignment
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={archived}
            onClick={() => update({ archived: archived ? null : 'true' })}
            className={cn(archived && 'border-primary/40 bg-accent/60')}
          >
            Archived
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={showFinished}
            disabled={archived}
            onClick={() => update({ finished: showFinished ? null : 'true' })}
            className={cn(showFinished && 'border-primary/40 bg-accent/60')}
          >
            Show finished
          </Button>
        </div>
        <WorkFilters organizationId={org.id} search={search} />
      </div>

      {isPending ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : isError ? (
        <ErrorState message={error.message} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={ListTodoIcon}
          title={
            activeFilterCount > 0 || flagged
              ? 'Nothing matches'
              : showFinished || archived
                ? 'No tasks yet'
                : 'No active tasks'
          }
          description={
            activeFilterCount > 0 || flagged
              ? 'Try removing a filter.'
              : showFinished || archived
                ? 'Create the first task for your team.'
                : 'Create a task, or show finished ones.'
          }
        />
      ) : (
        <WorkTable
          page={data}
          timezone={org.timezone}
          sort={filters.sort ?? 'due'}
          showDepartment
          onSort={(sort) => update({ sort: sort === 'due' ? null : sort })}
          onOpen={openTask}
          onPageChange={(page) => update({ page })}
        />
      )}

      {creating ? (
        <CreateTaskDialog onClose={() => setCreating(false)} onCreated={openTask} />
      ) : null}
      <TaskDetailSheet taskId={openTaskId} timezone={org.timezone} onClose={() => openTask(null)} />
    </motion.div>
  )
}
