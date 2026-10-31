import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { BellIcon, CheckCheckIcon, ChevronLeftIcon, ChevronRightIcon, LockIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'

import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState, ErrorState } from '@/components/shared/StatePanels'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useMyUpdateRequests } from '@/features/collaboration/api'
import { RespondDialog } from '@/features/collaboration/components/TaskUpdateRequests'
import type { PendingUpdateRequest } from '@/features/collaboration/types'
import { useInbox, useInboxSummary, useMarkAllRead, useMarkRead } from '@/features/inbox/api'
import {
  describeNotification,
  type InboxFilter,
  type InboxNotification,
  type InboxWorkspace,
} from '@/features/inbox/types'
import { taskPath } from '@/features/tasks/task-path'
import { errorText } from '@/lib/api-client'
import { pageEnter } from '@/lib/motion'
import { cn } from '@/lib/utils'

const TABS: { value: InboxFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'assignments', label: 'Assignments' },
  { value: 'update_requests', label: 'Update requests' },
]

// These people aren't members now, so there's no organization page to open.
const NO_PAGE = new Set(['membership_rejected', 'membership_removed', 'membership_suspended'])

function link(item: InboxNotification, workspace: InboxWorkspace) {
  // Personal holds notices from organizations the person can't open any more.
  if (workspace === 'personal') return null
  if (item.task) return taskPath(item.task)
  if (item.organization_id && !NO_PAGE.has(item.type)) return `/org/${item.organization_id}`
  return null
}

function NotificationRow({
  item,
  workspace,
}: {
  item: InboxNotification
  workspace: InboxWorkspace
}) {
  const navigate = useNavigate()
  const markRead = useMarkRead()
  const target = link(item, workspace)

  const open = () => {
    if (!item.read) markRead.mutate(item.id)
    if (target) void navigate(target)
  }

  return (
    <li>
      <button
        type="button"
        onClick={open}
        className={cn(
          'flex w-full items-start gap-3 rounded-xl p-3 text-left shadow-card transition-shadow duration-(--duration-fast) outline-none hover:shadow-raised focus-visible:ring-3 focus-visible:ring-ring/50',
          item.read ? 'bg-card' : 'bg-accent/50',
        )}
      >
        <span
          className={cn(
            'mt-1.5 size-2 shrink-0 rounded-full',
            item.read ? 'bg-transparent' : 'bg-primary',
          )}
        />
        <span className="min-w-0 flex-1">
          {item.accessible ? (
            <>
              <span className="block text-sm wrap-anywhere">{describeNotification(item)}</span>
              {item.task ? (
                <span className="block truncate text-sm font-medium">{item.task.title}</span>
              ) : null}
            </>
          ) : (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <LockIcon aria-hidden className="size-3.5 shrink-0" />
              You no longer have access to this item
            </span>
          )}
          <span className="block text-xs text-muted-foreground">
            {item.read ? '' : 'Unread · '}
            {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
          </span>
        </span>
      </button>
    </li>
  )
}

function UpdatesToAnswer({ workspace }: { workspace: InboxWorkspace }) {
  const { data = [] } = useMyUpdateRequests(workspace)
  const [responding, setResponding] = useState<PendingUpdateRequest | null>(null)
  if (data.length === 0) return null
  return (
    <section aria-labelledby="updates-heading" className="space-y-2">
      <h2 id="updates-heading" className="text-sm font-semibold">
        Waiting for your update
      </h2>
      <ul className="space-y-2">
        {data.map((request) => (
          <li
            key={request.id}
            className="flex flex-col gap-2 rounded-xl bg-card p-3 shadow-card sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-medium">{request.task_title}</p>
              <p className="wrap-anywhere text-muted-foreground">
                {request.requester.name}: {request.message}
              </p>
            </div>
            <Button
              size="sm"
              aria-label={`Respond about ${request.task_title}`}
              onClick={() => setResponding(request)}
            >
              Respond
            </Button>
          </li>
        ))}
      </ul>
      {responding ? (
        <RespondDialog
          request={responding}
          statuses={responding.allowed_statuses}
          onClose={() => setResponding(null)}
        />
      ) : null}
    </section>
  )
}

/** One workspace's inbox: `/inbox` for Personal, `/org/:id/inbox` for an organization. */
export function InboxPage() {
  const organizationId = useParams().organizationId
  const workspace: InboxWorkspace = organizationId ? Number(organizationId) : 'personal'
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [page, setPage] = useState(1)
  const { data, isPending, isError, error, refetch } = useInbox(workspace, filter, page)
  const { data: summary } = useInboxSummary(workspace)
  const markAll = useMarkAllRead(workspace)
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1
  const personal = workspace === 'personal'
  // Assignments and update requests only happen inside an organization.
  const tabs = personal ? TABS.slice(0, 2) : TABS

  return (
    <motion.div {...pageEnter} className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="Inbox"
        description={
          personal
            ? 'Updates about organizations you’ve left or asked to join.'
            : 'Assignments, update requests and changes that involve you.'
        }
        actions={
          summary && summary.unread > 0 ? (
            <Button
              variant="outline"
              size="sm"
              disabled={markAll.isPending}
              onClick={() =>
                markAll.mutate(undefined, { onError: (e) => toast.error(errorText(e)) })
              }
            >
              <CheckCheckIcon data-icon="inline-start" />
              Mark all as read
            </Button>
          ) : null
        }
      />
      <UpdatesToAnswer workspace={workspace} />
      <nav
        aria-label="Inbox filter"
        className="flex max-w-full flex-wrap gap-1 rounded-lg bg-muted p-1"
      >
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            aria-pressed={filter === tab.value}
            onClick={() => {
              setFilter(tab.value)
              setPage(1)
            }}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-(--duration-fast) outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              filter === tab.value
                ? 'bg-card text-foreground shadow-card'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      {isPending ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : isError ? (
        <ErrorState message={error.message} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={BellIcon}
          title={filter === 'unread' ? 'You’re all caught up' : 'Nothing here yet'}
          description={
            personal
              ? 'Your organizations’ notices are in their own inboxes.'
              : 'New assignments, mentions and update requests will appear here.'
          }
        />
      ) : (
        <>
          <ul className="space-y-2">
            {data.items.map((item) => (
              <NotificationRow key={item.id} item={item} workspace={workspace} />
            ))}
          </ul>
          {pageCount > 1 ? (
            <nav aria-label="Pagination" className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground tabular-nums">
                Page {page} of {pageCount}
              </p>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeftIcon data-icon="inline-start" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pageCount}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                  <ChevronRightIcon data-icon="inline-end" />
                </Button>
              </div>
            </nav>
          ) : null}
        </>
      )}
    </motion.div>
  )
}
