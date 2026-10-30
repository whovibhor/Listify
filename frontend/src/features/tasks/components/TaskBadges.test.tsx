import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { TaskPriorityBadge, TaskStatusBadge } from '@/features/tasks/components/TaskBadges'
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from '@/features/tasks/task-meta'

describe('task badges', () => {
  it.each(TASK_STATUSES)('renders a text label for status %s', (status) => {
    render(<TaskStatusBadge status={status} />)
    expect(screen.getByText(STATUS_LABELS[status])).toBeInTheDocument()
  })

  it.each(TASK_PRIORITIES)('renders a text label for priority %s', (priority) => {
    render(<TaskPriorityBadge priority={priority} />)
    expect(screen.getByText(PRIORITY_LABELS[priority])).toBeInTheDocument()
  })
})
