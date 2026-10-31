import type { ReactNode } from 'react'
import { format } from 'date-fns'
import { XIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useMe } from '@/features/auth/api'
import { MemberAvatar } from '@/features/organizations/components/MemberAvatar'
import { useUpdateTask } from '@/features/tasks/api'
import { DueChip } from '@/features/tasks/components/DueChip'
import { TagChip } from '@/features/tasks/components/TagChip'
import { TaskPriorityBadge } from '@/features/tasks/components/TaskBadges'
import { inZone } from '@/features/tasks/dates'
import type { TaskDetail } from '@/features/tasks/types'
import { useRemoveCollaborator } from '@/features/work/api'
import { VISIBILITY_HINTS, VISIBILITY_LABELS } from '@/features/work/types'
import { errorText } from '@/lib/api-client'

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  )
}

function Person({ name }: { name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <MemberAvatar name={name} className="size-6 text-[0.625rem]" />
      <span className="min-w-0 truncate">{name}</span>
    </span>
  )
}

function OrganizationFacts({ task, archived }: { task: TaskDetail; archived: boolean }) {
  const { data: me } = useMe()
  const update = useUpdateTask(task.id)
  const removeCollaborator = useRemoveCollaborator(task.id)
  const fail = (error: Error) => toast.error(errorText(error))

  return (
    <>
      <Fact label="Assignee">
        {task.assignee ? (
          <Person name={task.assignee.name} />
        ) : archived || !me ? (
          'Unassigned'
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={update.isPending}
            onClick={() => update.mutate({ assigned_to: me.id }, { onError: fail })}
          >
            Assign to me
          </Button>
        )}
      </Fact>
      <Fact label="Collaborators">
        {task.collaborators.length ? (
          <div className="flex flex-wrap gap-1.5">
            {task.collaborators.map((person) => (
              <Badge key={person.id} variant="secondary">
                {person.name}
                {person.id === me?.id && !archived ? (
                  <button
                    type="button"
                    aria-label={`Remove ${person.name}`}
                    onClick={() => removeCollaborator.mutate(person.id, { onError: fail })}
                  >
                    <XIcon aria-hidden className="size-3" />
                  </button>
                ) : null}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">None</span>
        )}
      </Fact>
      <Fact label="Department">{task.department?.name ?? 'No department'}</Fact>
    </>
  )
}

/** Everything about a task at a glance. Changes go through Edit, except the two quick ones here. */
export function TaskDetailsRail({ task, timezone }: { task: TaskDetail; timezone: string }) {
  const hasPeople = task.organization_id !== null && task.parent_task_id === null
  const archived = task.archived_at !== null
  const date = (value: string) => format(inZone(value, timezone), 'd MMM yyyy')

  return (
    <section aria-label="Task details" className="rounded-2xl bg-card p-4 shadow-card">
      <dl className="space-y-4">
        {hasPeople ? <OrganizationFacts task={task} archived={archived} /> : null}
        <Fact label="Priority">
          <TaskPriorityBadge priority={task.priority} />
        </Fact>
        <Fact label="Deadline">
          {task.due_at ? (
            <DueChip task={task} timezone={timezone} />
          ) : (
            <span className="text-muted-foreground">No deadline</span>
          )}
        </Fact>
        {task.start_at ? <Fact label="Start date">{date(task.start_at)}</Fact> : null}
        {task.completed_at ? <Fact label="Completed">{date(task.completed_at)}</Fact> : null}
        <Fact label="Tags">
          {task.tags.length ? (
            <div className="flex flex-wrap gap-1.5">
              {task.tags.map((tag) => (
                <TagChip key={tag.id} tag={tag} />
              ))}
            </div>
          ) : (
            <span className="text-muted-foreground">None</span>
          )}
        </Fact>
        {hasPeople ? (
          <Fact label="Visibility">
            <span className="block">{VISIBILITY_LABELS[task.visibility]}</span>
            <span className="block text-xs text-muted-foreground">
              {VISIBILITY_HINTS[task.visibility]}
            </span>
            {task.visibility === 'selected' && task.visible_to.length ? (
              <span className="mt-1.5 flex flex-wrap gap-1.5">
                {task.visible_to.map((person) => (
                  <Badge key={person.id} variant="secondary">
                    {person.name}
                  </Badge>
                ))}
              </span>
            ) : null}
          </Fact>
        ) : null}
        {task.organization_id !== null && !hasPeople ? (
          <Fact label="People">
            <span className="text-muted-foreground">
              Assignee, department and visibility come from the parent task.
            </span>
          </Fact>
        ) : null}
        <Fact label="Created">
          {date(task.created_at)}
          {task.creator ? ` by ${task.creator.name}` : ''}
        </Fact>
      </dl>
    </section>
  )
}
