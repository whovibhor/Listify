import { useState, type FormEvent } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { FormField } from '@/components/shared/FormField'
import { NativeSelect } from '@/components/shared/NativeSelect'
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
import { useTags, useUpdateTask } from '@/features/tasks/api'
import { TagChip } from '@/features/tasks/components/TagChip'
import { TagPicker } from '@/features/tasks/components/TagPicker'
import { dateInputs } from '@/features/tasks/dates'
import { PRIORITY_LABELS, TASK_PRIORITIES, type TaskPriority } from '@/features/tasks/task-meta'
import type { TaskDetail, TaskInput } from '@/features/tasks/types'
import { useAddCollaborator, useRemoveCollaborator } from '@/features/work/api'
import { TaskPeopleForm } from '@/features/work/components/TaskPeopleForm'
import { taskPeople, type TaskPeople } from '@/features/work/task-people'
import { errorText } from '@/lib/api-client'

const sameItems = (first: number[], second: number[]) =>
  first.length === second.length && first.every((item) => second.includes(item))

function peopleChanges(task: TaskDetail, before: TaskPeople, after: TaskPeople) {
  const input: TaskInput = {}
  if (task.actions.includes('move') && after.departmentId !== before.departmentId)
    input.department_id = after.departmentId
  if (task.actions.includes('assign') && after.assigneeId !== before.assigneeId)
    input.assigned_to = after.assigneeId
  if (task.actions.includes('change_visibility')) {
    if (after.visibility !== before.visibility) input.visibility = after.visibility
    if (after.visibility === 'selected' && !sameItems(after.visibleTo, before.visibleTo)) {
      input.visibility = 'selected'
      input.visible_to = after.visibleTo
    }
  }
  return input
}

export function TaskEditDialog({
  task,
  timezone,
  onClose,
}: {
  task: TaskDetail
  timezone: string
  onClose: () => void
}) {
  const isOrganizationTask = task.organization_id !== null
  const hasPeople = isOrganizationTask && task.parent_task_id === null
  const canEditDetails = !isOrganizationTask || task.actions.includes('edit')
  const dates = dateInputs(task, timezone)
  const update = useUpdateTask(task.id)
  const addCollaborator = useAddCollaborator(task.id)
  const removeCollaborator = useRemoveCollaborator(task.id)
  const { data: allTags = [] } = useTags(task.organization_id)

  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description ?? '')
  const [priority, setPriority] = useState<TaskPriority>(task.priority)
  const [dueDate, setDueDate] = useState(dates.due_date)
  const [dueTime, setDueTime] = useState(dates.due_time)
  const [startDate, setStartDate] = useState(dates.start_date)
  const [tagIds, setTagIds] = useState(task.tags.map((tag) => tag.id))
  const [people, setPeople] = useState(() => taskPeople(task))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  const knownTags = [...task.tags, ...allTags.filter((tag) => !task.tags.includes(tag))]
  const selectedTags = tagIds.flatMap((id) => knownTags.find((tag) => tag.id === id) ?? [])

  const detailChanges = () => {
    const input: TaskInput = {}
    if (title.trim() !== task.title) input.title = title.trim()
    if (description !== (task.description ?? '')) input.description = description || null
    if (priority !== task.priority) input.priority = priority
    if (dueDate !== dates.due_date || dueTime !== dates.due_time) {
      input.due_date = dueDate || null
      input.due_time = dueDate ? dueTime || null : null
    }
    if (startDate !== dates.start_date) input.start_date = startDate || null
    if (
      !sameItems(
        tagIds,
        task.tags.map((tag) => tag.id),
      )
    )
      input.tag_ids = tagIds
    return input
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (canEditDetails && !title.trim()) return setError('Enter a title.')
    const before = taskPeople(task)
    const input = {
      ...(canEditDetails ? detailChanges() : {}),
      ...(hasPeople ? peopleChanges(task, before, people) : {}),
    }
    const managesCollaborators = hasPeople && task.actions.includes('manage_collaborators')
    const added = managesCollaborators
      ? people.collaboratorIds.filter((id) => !before.collaboratorIds.includes(id))
      : []
    const removed = managesCollaborators
      ? before.collaboratorIds.filter((id) => !people.collaboratorIds.includes(id))
      : []

    setSaving(true)
    setError(undefined)
    try {
      if (Object.keys(input).length) await update.mutateAsync(input)
      for (const userId of added) await addCollaborator.mutateAsync(userId)
      for (const userId of removed) await removeCollaborator.mutateAsync(userId)
      toast.success('Task saved')
      onClose()
    } catch (saveError) {
      setError(errorText(saveError as Error))
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
          <DialogDescription>Changes are saved when you press Save.</DialogDescription>
        </DialogHeader>
        <form id="task-edit-form" onSubmit={(event) => void submit(event)} className="space-y-4">
          {canEditDetails ? (
            <>
              <FormField label="Title">
                <Input
                  autoFocus
                  value={title}
                  maxLength={200}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </FormField>
              <FormField label="Description">
                <Textarea
                  value={description}
                  maxLength={10_000}
                  placeholder="Add notes, links or context…"
                  className="min-h-28"
                  onChange={(event) => setDescription(event.target.value)}
                />
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="Deadline">
                  <Input
                    type="date"
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                  />
                </FormField>
                <FormField label="Deadline time (optional)">
                  <Input
                    type="time"
                    value={dueTime}
                    disabled={!dueDate}
                    onChange={(event) => setDueTime(event.target.value)}
                  />
                </FormField>
              </div>
              <FormField label="Start date">
                <Input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </FormField>
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Tags</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {selectedTags.map((tag) => (
                    <TagChip
                      key={tag.id}
                      tag={tag}
                      onRemove={() => setTagIds(tagIds.filter((id) => id !== tag.id))}
                    />
                  ))}
                  <TagPicker
                    organizationId={task.organization_id}
                    selected={selectedTags}
                    onChange={setTagIds}
                  />
                </div>
              </div>
            </>
          ) : null}
          {hasPeople ? (
            <TaskPeopleForm
              task={task}
              value={people}
              onChange={(changes) => setPeople({ ...people, ...changes })}
            />
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="task-edit-form" disabled={saving}>
            {saving ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
