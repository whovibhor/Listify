import { useState } from 'react'
import { BriefcaseIcon, PlusIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useSearchParams } from 'react-router'

import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { useOrg } from '@/features/organizations/use-current-org'
import { TaskDetailSheet } from '@/features/tasks/components/TaskDetailSheet'
import { TaskList } from '@/features/tasks/components/TaskList'
import { useTaskSearchParams } from '@/features/tasks/use-task-search-params'
import { useOrganizationTasks } from '@/features/work/api'
import { CreateTaskDialog } from '@/features/work/components/CreateTaskDialog'
import { pageEnter } from '@/lib/motion'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 25

const TABS = [
  { value: 'my_work', label: 'Assigned to me' },
  { value: 'collaborating', label: 'Collaborating' },
] as const

/** The work that's yours in this organization, separate from your personal tasks. */
export function MyWorkPage() {
  const org = useOrg()
  const { filters, update, openTaskId, openTask } = useTaskSearchParams()
  const [params] = useSearchParams()
  const [creating, setCreating] = useState(false)
  const view = params.get('view') === 'collaborating' ? 'collaborating' : 'my_work'
  const query = useOrganizationTasks(org.id, { view, page: filters.page, page_size: PAGE_SIZE })

  return (
    <motion.div {...pageEnter} className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="My Work"
        description="Open tasks you’re responsible for or helping with."
        actions={
          <Button onClick={() => setCreating(true)}>
            <PlusIcon data-icon="inline-start" />
            New task
          </Button>
        }
      />
      <nav aria-label="My work" className="inline-flex rounded-lg bg-muted p-1">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            aria-pressed={view === tab.value}
            onClick={() => update({ view: tab.value === 'my_work' ? null : tab.value })}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-(--duration-fast) outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              view === tab.value
                ? 'bg-card text-foreground shadow-card'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <TaskList
        query={query}
        timezone={org.timezone}
        onOpen={openTask}
        selectedId={openTaskId}
        onPageChange={(page) => update({ page })}
        empty={{
          icon: BriefcaseIcon,
          title: view === 'my_work' ? 'Nothing assigned to you' : 'Not collaborating on anything',
          description: 'Tasks appear here as soon as someone adds you to them.',
        }}
      />
      {creating ? (
        <CreateTaskDialog onClose={() => setCreating(false)} onCreated={openTask} />
      ) : null}
      <TaskDetailSheet taskId={openTaskId} timezone={org.timezone} onClose={() => openTask(null)} />
    </motion.div>
  )
}
