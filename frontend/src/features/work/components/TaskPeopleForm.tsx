import { Badge } from '@/components/ui/badge'
import { FormField } from '@/components/shared/FormField'
import { NativeSelect } from '@/components/shared/NativeSelect'
import { useDepartments, useMembers, useMyOrganizations } from '@/features/organizations/api'
import { can } from '@/features/organizations/permissions'
import type { TaskDetail, TaskVisibility } from '@/features/tasks/types'
import { PeoplePicker } from '@/features/work/components/PeoplePicker'
import type { TaskPeople } from '@/features/work/task-people'
import { VISIBILITY_HINTS, VISIBILITY_LABELS } from '@/features/work/types'

function toggled(list: number[], value: number) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

/** Department, people and visibility, showing only what this person may change on this task. */
export function TaskPeopleForm({
  task,
  value,
  onChange,
}: {
  task: TaskDetail
  value: TaskPeople
  onChange: (changes: Partial<TaskPeople>) => void
}) {
  const organizationId = task.organization_id!
  const { data: organizations = [] } = useMyOrganizations()
  const org = organizations.find((candidate) => candidate.id === organizationId)
  const { data: departments = [] } = useDepartments(organizationId)
  const { data: assignable } = useMembers(organizationId, {
    department_id: value.departmentId ?? undefined,
    status: 'active',
    page_size: 100,
  })
  const { data: everyone } = useMembers(organizationId, { status: 'active', page_size: 100 })
  const people = everyone?.items ?? []
  const allowed = (action: string) => task.actions.includes(action)

  const visibilityOptions: TaskVisibility[] = [
    ...(value.departmentId ? (['department'] as const) : []),
    'private',
    'selected',
    ...(org && (can(org, 'task.view_all') || task.visibility === 'organization')
      ? (['organization'] as const)
      : []),
  ]

  return (
    <>
      {allowed('move') ? (
        <FormField label="Department">
          <NativeSelect
            value={value.departmentId ?? ''}
            onChange={(event) =>
              onChange({ departmentId: event.target.value ? Number(event.target.value) : null })
            }
          >
            <option value="">No department</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      ) : null}
      {allowed('assign') ? (
        <FormField label="Assignee">
          <NativeSelect
            value={value.assigneeId ?? ''}
            onChange={(event) =>
              onChange({ assigneeId: event.target.value ? Number(event.target.value) : null })
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
        </FormField>
      ) : null}
      {allowed('manage_collaborators') ? (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Collaborators</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {people
              .filter((person) => value.collaboratorIds.includes(person.user_id))
              .map((person) => (
                <Badge key={person.user_id} variant="secondary">
                  {person.name}
                </Badge>
              ))}
            <PeoplePicker
              label="Add collaborator"
              people={people.filter((person) => person.user_id !== value.assigneeId)}
              selected={value.collaboratorIds}
              onToggle={(userId) =>
                onChange({ collaboratorIds: toggled(value.collaboratorIds, userId) })
              }
            />
          </div>
        </div>
      ) : null}
      {allowed('change_visibility') ? (
        <div className="space-y-2">
          <FormField label="Visibility">
            <NativeSelect
              value={value.visibility}
              onChange={(event) => onChange({ visibility: event.target.value as TaskVisibility })}
            >
              {visibilityOptions.map((option) => (
                <option key={option} value={option}>
                  {VISIBILITY_LABELS[option]}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <p className="text-xs text-muted-foreground">{VISIBILITY_HINTS[value.visibility]}</p>
          {value.visibility === 'selected' ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {people
                .filter((person) => value.visibleTo.includes(person.user_id))
                .map((person) => (
                  <Badge key={person.user_id} variant="secondary">
                    {person.name}
                  </Badge>
                ))}
              <PeoplePicker
                label="Choose people"
                people={people}
                selected={value.visibleTo}
                onToggle={(userId) => onChange({ visibleTo: toggled(value.visibleTo, userId) })}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
