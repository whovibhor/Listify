import { useState, type ReactNode } from 'react'
import { TriangleAlertIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import { NativeSelect } from '@/components/shared/NativeSelect'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useMe } from '@/features/auth/api'
import { useDepartments, useMembers, useMyOrganizations } from '@/features/organizations/api'
import { can } from '@/features/organizations/permissions'
import { useUpdateTask } from '@/features/tasks/api'
import type { TaskDetail, TaskInput, TaskVisibility } from '@/features/tasks/types'
import { useAddCollaborator, useRemoveCollaborator } from '@/features/work/api'
import { PeoplePicker } from '@/features/work/components/PeoplePicker'
import { VISIBILITY_HINTS, VISIBILITY_LABELS } from '@/features/work/types'
import { errorText } from '@/lib/api-client'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-center gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  )
}

/** Department, people and visibility of an organization task, inside the shared task panel. */
export function TaskPeopleFields({ task, readOnly }: { task: TaskDetail; readOnly: boolean }) {
  const organizationId = task.organization_id!
  const { data: me } = useMe()
  const { data: organizations = [] } = useMyOrganizations()
  const org = organizations.find((candidate) => candidate.id === organizationId)
  const { data: departments = [] } = useDepartments(organizationId)
  const { data: assignable } = useMembers(organizationId, {
    department_id: task.department?.id,
    status: 'active',
    page_size: 100,
  })
  const { data: everyone } = useMembers(organizationId, { status: 'active', page_size: 100 })
  const update = useUpdateTask(task.id)
  const addCollaborator = useAddCollaborator(task.id)
  const removeCollaborator = useRemoveCollaborator(task.id)
  const [choosingPeople, setChoosingPeople] = useState(false)

  const allowed = (action: string) => !readOnly && task.actions.includes(action)
  const people = everyone?.items ?? []
  const fail = (error: Error) => toast.error(errorText(error))
  const save = (input: TaskInput) => update.mutate(input, { onError: fail })
  const claimable = !readOnly && !task.assignee && me && task.assignee === null

  const visibilityOptions: TaskVisibility[] = [
    ...(task.department ? (['department'] as const) : []),
    'private',
    'selected',
    ...(org && (can(org, 'task.view_all') || task.visibility === 'organization')
      ? (['organization'] as const)
      : []),
  ]
  const chosenVisibility = choosingPeople ? 'selected' : task.visibility

  const toggleVisibleTo = (userId: number) => {
    const current = task.visible_to.map((person) => person.id)
    const next = current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId]
    if (next.length === 0) return
    update.mutate(
      { visibility: 'selected', visible_to: next },
      { onSuccess: () => setChoosingPeople(false), onError: fail },
    )
  }

  return (
    <div className="space-y-3">
      {task.needs_reassignment ? (
        <p className="flex gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {task.assignee?.name} can no longer work on this task. Choose someone else.
        </p>
      ) : null}
      <Row label="Created by">{task.creator?.name}</Row>
      <Row label="Department">
        {allowed('move') ? (
          <NativeSelect
            aria-label="Department"
            value={task.department?.id ?? ''}
            onChange={(event) =>
              save({ department_id: event.target.value ? Number(event.target.value) : null })
            }
          >
            <option value="">No department</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </NativeSelect>
        ) : (
          (task.department?.name ?? 'No department')
        )}
      </Row>
      <Row label="Assignee">
        {allowed('assign') ? (
          <NativeSelect
            aria-label="Assignee"
            value={task.assignee?.id ?? ''}
            onChange={(event) =>
              save({ assigned_to: event.target.value ? Number(event.target.value) : null })
            }
          >
            <option value="">Unassigned</option>
            {/* Someone who has left stays listed until they're replaced. */}
            {task.assignee &&
            !assignable?.items.some((person) => person.user_id === task.assignee?.id) ? (
              <option value={task.assignee.id}>{task.assignee.name}</option>
            ) : null}
            {assignable?.items.map((person) => (
              <option key={person.user_id} value={person.user_id}>
                {person.name}
              </option>
            ))}
          </NativeSelect>
        ) : claimable ? (
          <Button
            variant="outline"
            size="sm"
            disabled={update.isPending}
            onClick={() => save({ assigned_to: me.id })}
          >
            Assign to me
          </Button>
        ) : (
          (task.assignee?.name ?? 'Unassigned')
        )}
      </Row>
      <Row label="Collaborators">
        <div className="flex flex-wrap items-center gap-1.5">
          {task.collaborators.map((person) => {
            const removable = allowed('manage_collaborators') || person.id === me?.id
            return (
              <Badge key={person.id} variant="secondary">
                {person.name}
                {removable && !readOnly ? (
                  <button
                    type="button"
                    aria-label={`Remove ${person.name}`}
                    onClick={() => removeCollaborator.mutate(person.id, { onError: fail })}
                  >
                    <XIcon aria-hidden className="size-3" />
                  </button>
                ) : null}
              </Badge>
            )
          })}
          {allowed('manage_collaborators') ? (
            <PeoplePicker
              label="Add collaborator"
              people={people.filter((person) => person.user_id !== task.assignee?.id)}
              selected={task.collaborators.map((person) => person.id)}
              onToggle={(userId) =>
                task.collaborators.some((person) => person.id === userId)
                  ? removeCollaborator.mutate(userId, { onError: fail })
                  : addCollaborator.mutate(userId, { onError: fail })
              }
            />
          ) : task.collaborators.length === 0 ? (
            <span className="text-muted-foreground">None</span>
          ) : null}
        </div>
      </Row>
      <Row label="Visibility">
        {allowed('change_visibility') ? (
          <NativeSelect
            aria-label="Visibility"
            value={chosenVisibility}
            onChange={(event) => {
              const value = event.target.value as TaskVisibility
              if (value === 'selected' && task.visibility !== 'selected') setChoosingPeople(true)
              else {
                setChoosingPeople(false)
                save({ visibility: value })
              }
            }}
          >
            {visibilityOptions.map((option) => (
              <option key={option} value={option}>
                {VISIBILITY_LABELS[option]}
              </option>
            ))}
          </NativeSelect>
        ) : (
          VISIBILITY_LABELS[task.visibility]
        )}
      </Row>
      <p className="text-xs text-muted-foreground">{VISIBILITY_HINTS[chosenVisibility]}</p>
      {chosenVisibility === 'selected' ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {task.visible_to.map((person) => (
            <Badge key={person.id} variant="secondary">
              {person.name}
            </Badge>
          ))}
          {allowed('change_visibility') ? (
            <PeoplePicker
              label="Choose people"
              people={people}
              selected={task.visible_to.map((person) => person.id)}
              onToggle={toggleVisibleTo}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
