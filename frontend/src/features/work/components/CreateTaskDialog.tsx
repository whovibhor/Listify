import { useState, type FormEvent } from 'react'
import { Loader2Icon, XIcon } from 'lucide-react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'

import { FormField } from '@/components/shared/FormField'
import { NativeSelect } from '@/components/shared/NativeSelect'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useDepartments, useMembers } from '@/features/organizations/api'
import { can } from '@/features/organizations/permissions'
import { useOrg } from '@/features/organizations/use-current-org'
import { useCreateTask, useTags } from '@/features/tasks/api'
import { TagPicker } from '@/features/tasks/components/TagPicker'
import { PRIORITY_LABELS, TASK_PRIORITIES, type TaskPriority } from '@/features/tasks/task-meta'
import { taskPath } from '@/features/tasks/task-path'
import type { TaskVisibility } from '@/features/tasks/types'
import { PeoplePicker } from '@/features/work/components/PeoplePicker'
import { VISIBILITY_HINTS, VISIBILITY_LABELS } from '@/features/work/types'
import { errorText } from '@/lib/api-client'

function toggled(list: number[], value: number) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

interface CreateTaskDialogProps {
  /** Fixed when opened from a department's board. */
  departmentId?: number
  onClose: () => void
}

export function CreateTaskDialog({ departmentId, onClose }: CreateTaskDialogProps) {
  const org = useOrg()
  const navigate = useNavigate()
  const create = useCreateTask(org.id)
  const { data: departments = [] } = useDepartments(org.id)
  const { data: allTags = [] } = useTags(org.id)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [department, setDepartment] = useState(departmentId ? String(departmentId) : '')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [dueDate, setDueDate] = useState('')
  const [assignee, setAssignee] = useState('')
  const [collaborators, setCollaborators] = useState<number[]>([])
  const [visibility, setVisibility] = useState<TaskVisibility>(
    departmentId ? 'department' : 'private',
  )
  const [visibleTo, setVisibleTo] = useState<number[]>([])
  const [tagIds, setTagIds] = useState<number[]>([])
  const [error, setError] = useState<string>()

  const chosenDepartment = department ? Number(department) : undefined
  // Assignees need to be in the task's department; collaborators can come from anywhere.
  const { data: departmentMembers } = useMembers(org.id, {
    department_id: chosenDepartment,
    status: 'active',
    page_size: 100,
  })
  const { data: everyone } = useMembers(org.id, { status: 'active', page_size: 100 })
  const assignable = departmentMembers?.items ?? []
  const people = everyone?.items ?? []
  const nameOf = (userId: number) =>
    people.find((person) => person.user_id === userId)?.name ?? 'Unknown'

  const visibilityOptions: TaskVisibility[] = [
    ...(chosenDepartment ? (['department'] as const) : []),
    'private',
    'selected',
    ...(can(org, 'task.view_all') ? (['organization'] as const) : []),
  ]

  const chooseDepartment = (value: string) => {
    setDepartment(value)
    setAssignee('')
    setError(undefined)
    if (value && visibility === 'private') setVisibility('department')
    if (!value && visibility === 'department') setVisibility('private')
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    create.mutate(
      {
        title: title.trim(),
        description: description.trim() || null,
        priority,
        due_date: dueDate || null,
        tag_ids: tagIds,
        department_id: chosenDepartment ?? null,
        assigned_to: assignee ? Number(assignee) : null,
        collaborator_ids: collaborators.filter((userId) => userId !== Number(assignee)),
        visibility,
        visible_to: visibility === 'selected' ? visibleTo : [],
      },
      {
        onSuccess: (task) => {
          // Stays on the list, so several tasks can be added in a row.
          toast.success('Task created', {
            description: task.title,
            action: { label: 'Open task', onClick: () => void navigate(taskPath(task)) },
          })
          onClose()
        },
        onError: (mutationError) => setError(errorText(mutationError)),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>Dates use the organization’s time zone.</DialogDescription>
        </DialogHeader>
        <form id="create-task-form" onSubmit={submit} className="space-y-4">
          <FormField label="Title">
            <Input
              required
              autoFocus
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </FormField>
          <FormField label="Description (optional)">
            <Textarea
              className="min-h-16"
              maxLength={10_000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </FormField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Department">
              <NativeSelect
                value={department}
                disabled={departmentId !== undefined}
                onChange={(event) => chooseDepartment(event.target.value)}
              >
                <option value="">No department</option>
                {departments.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Assignee">
              <NativeSelect value={assignee} onChange={(event) => setAssignee(event.target.value)}>
                <option value="">Unassigned</option>
                {assignable.map((person) => (
                  <option key={person.user_id} value={person.user_id}>
                    {person.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Priority">
              <NativeSelect
                value={priority}
                onChange={(event) => setPriority(event.target.value as TaskPriority)}
              >
                {[...TASK_PRIORITIES].reverse().map((option) => (
                  <option key={option} value={option}>
                    {PRIORITY_LABELS[option]}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Deadline (optional)">
              <Input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </FormField>
          </div>
          <FormField label="Who can see this" hint={VISIBILITY_HINTS[visibility]}>
            <NativeSelect
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as TaskVisibility)}
            >
              {visibilityOptions.map((option) => (
                <option key={option} value={option}>
                  {VISIBILITY_LABELS[option]}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          {visibility === 'selected' ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <PeoplePicker
                label="Choose people"
                people={people}
                selected={visibleTo}
                onToggle={(userId) => setVisibleTo(toggled(visibleTo, userId))}
              />
              {visibleTo.map((userId) => (
                <Badge key={userId} variant="secondary">
                  {nameOf(userId)}
                  <button
                    type="button"
                    aria-label={`Remove ${nameOf(userId)}`}
                    onClick={() => setVisibleTo(toggled(visibleTo, userId))}
                  >
                    <XIcon aria-hidden className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            <PeoplePicker
              label="Add collaborators"
              people={people.filter((person) => person.user_id !== Number(assignee))}
              selected={collaborators}
              onToggle={(userId) => setCollaborators(toggled(collaborators, userId))}
            />
            {collaborators.map((userId) => (
              <Badge key={userId} variant="secondary">
                {nameOf(userId)}
                <button
                  type="button"
                  aria-label={`Remove ${nameOf(userId)}`}
                  onClick={() => setCollaborators(toggled(collaborators, userId))}
                >
                  <XIcon aria-hidden className="size-3" />
                </button>
              </Badge>
            ))}
            <TagPicker
              organizationId={org.id}
              selected={allTags.filter((tag) => tagIds.includes(tag.id))}
              onChange={setTagIds}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </form>
        <DialogFooter>
          <Button
            type="submit"
            form="create-task-form"
            disabled={create.isPending || !title.trim()}
          >
            {create.isPending ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : null}
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
