import type { TaskDetail, TaskVisibility } from '@/features/tasks/types'

export interface TaskPeople {
  departmentId: number | null
  assigneeId: number | null
  collaboratorIds: number[]
  visibility: TaskVisibility
  visibleTo: number[]
}

export function taskPeople(task: TaskDetail): TaskPeople {
  return {
    departmentId: task.department?.id ?? null,
    assigneeId: task.assignee?.id ?? null,
    collaboratorIds: task.collaborators.map((person) => person.id),
    visibility: task.visibility,
    visibleTo: task.visible_to.map((person) => person.id),
  }
}
