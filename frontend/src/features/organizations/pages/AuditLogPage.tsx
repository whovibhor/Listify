import { useState } from 'react'
import { format } from 'date-fns'
import { ChevronLeftIcon, ChevronRightIcon, ScrollTextIcon } from 'lucide-react'
import { motion } from 'motion/react'

import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState, ErrorState } from '@/components/shared/StatePanels'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PermissionDenied } from '@/features/organizations/components/OrganizationLayout'
import { useAuditLog } from '@/features/organizations/api'
import { can } from '@/features/organizations/permissions'
import type { AuditEntry } from '@/features/organizations/types'
import { useOrg } from '@/features/organizations/use-current-org'
import { pageEnter } from '@/lib/motion'

function describe(entry: AuditEntry): string {
  const details = entry.details ?? {}
  const who = typeof details.user_name === 'string' ? details.user_name : 'someone'
  const name = typeof details.name === 'string' ? details.name : ''
  const texts: Record<string, string> = {
    'organization.created': 'created the organization',
    'organization.updated': 'updated organization settings',
    'department.created': `created the ${name} department`,
    'department.updated': 'updated a department',
    'department.archived': `archived the ${name} department`,
    'department.restored': `restored the ${name} department`,
    'membership.approved': `approved ${who}`,
    'membership.rejected': `declined ${who}`,
    'invitation.created': `invited ${typeof details.email === 'string' ? details.email : 'someone by link'}`,
    'invitation.revoked': 'revoked an invitation',
    'invitation.accepted': 'accepted an invitation',
  }
  return texts[entry.action] ?? entry.action.replaceAll('.', ' ')
}

export function AuditLogPage() {
  const org = useOrg()
  const allowed = can(org, 'organization.settings.update')
  const [page, setPage] = useState(1)
  const { data, isPending, isError, error, refetch } = useAuditLog(org.id, page)

  if (!allowed) return <PermissionDenied />

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  return (
    <motion.div {...pageEnter} className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="Activity log"
        description="A permanent record of important changes. It can’t be edited."
      />
      {isPending ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : isError ? (
        <ErrorState message={error.message} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={ScrollTextIcon}
          title="Nothing here yet"
          description="Administrative changes will be recorded here."
        />
      ) : (
        <>
          <ol className="divide-y divide-border/60 rounded-2xl bg-card px-4 shadow-card">
            {data.items.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-col gap-0.5 py-3 sm:flex-row sm:items-center sm:gap-4"
              >
                <p className="min-w-0 flex-1 text-sm">
                  <span className="font-medium">{entry.actor_name ?? 'Someone'}</span>{' '}
                  <span className="text-muted-foreground">{describe(entry)}</span>
                </p>
                <time
                  dateTime={entry.created_at}
                  className="shrink-0 text-xs text-muted-foreground"
                >
                  {format(new Date(entry.created_at), 'd MMM yyyy, HH:mm')}
                </time>
              </li>
            ))}
          </ol>
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
