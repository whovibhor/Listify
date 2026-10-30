import type { ReactNode } from 'react'
import { ShieldAlertIcon } from 'lucide-react'
import { Outlet, useParams } from 'react-router'

import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { EmptyState, ErrorState } from '@/components/shared/StatePanels'
import { Skeleton } from '@/components/ui/skeleton'
import { useMyOrganizations } from '@/features/organizations/api'

/**
 * Everything under /org/:id. An organization the user isn't an active member of looks exactly
 * like a page that doesn't exist, matching the API's 404.
 */
export function OrganizationLayout() {
  const { organizationId } = useParams()
  const { data: organizations, isPending, isError, error, refetch } = useMyOrganizations()

  if (isPending) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading organization">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    )
  }
  if (isError) {
    return (
      <ErrorState
        title="Couldn't load this organization"
        message={error.message}
        onRetry={() => void refetch()}
      />
    )
  }
  const org = organizations.find((candidate) => candidate.id === Number(organizationId))
  if (!org) return <NotFoundPage />
  return <Outlet context={org} />
}

export function PermissionDenied({ children }: { children?: ReactNode }) {
  return (
    <EmptyState
      icon={ShieldAlertIcon}
      title="You don't have access to this page"
      description={children ?? 'Ask an organization administrator if you need this.'}
    />
  )
}
