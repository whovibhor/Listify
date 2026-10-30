import { CircleCheckBigIcon } from 'lucide-react'

import { TaskViewPage } from '@/features/personal-tasks/components/TaskViewPage'

export function CompletedPage() {
  return (
    <TaskViewPage
      view="completed"
      title="Completed"
      description="Finished tasks, most recent first. Un-tick a task to reopen it."
      quickAdd={false}
      statuses={[]}
      sorts={['completed', 'due', 'priority', 'title']}
      defaultSort="completed"
      showOverdueFilter={false}
      empty={{
        icon: CircleCheckBigIcon,
        title: 'Nothing completed yet',
        description: 'Tick the circle next to a task when it is done. It will be listed here.',
      }}
    />
  )
}
