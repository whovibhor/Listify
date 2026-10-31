import type { ComponentProps } from 'react'
import { Link, useLocation } from 'react-router'

import { taskPath } from '@/features/tasks/task-path'
import type { Task } from '@/features/tasks/types'

type TaskLinkProps = Omit<ComponentProps<typeof Link>, 'to' | 'state'> & {
  task: Pick<Task, 'id' | 'organization_id'>
}

/** Remembers the list it came from, filters included, for the task page's Back link. */
export function TaskLink({ task, ...props }: TaskLinkProps) {
  const { pathname, search } = useLocation()
  return <Link to={taskPath(task)} state={{ from: `${pathname}${search}` }} {...props} />
}
