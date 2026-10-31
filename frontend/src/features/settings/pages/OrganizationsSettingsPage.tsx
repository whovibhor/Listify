import { ArrowRightIcon, Building2Icon, PlusIcon, UsersRoundIcon } from 'lucide-react'
import { Link } from 'react-router'

import { ErrorState } from '@/components/shared/StatePanels'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useMyOrganizations } from '@/features/organizations/api'
import { primaryRoleLabel } from '@/features/organizations/permissions'

function MyOrganizations() {
  const { data: organizations, isPending, isError, error, refetch } = useMyOrganizations()

  if (isPending) return <Skeleton className="h-14 w-full rounded-lg" />
  if (isError) return <ErrorState message={error.message} onRetry={() => void refetch()} />
  if (organizations.length === 0) {
    return <p className="text-sm text-muted-foreground">You haven't joined an organization yet.</p>
  }
  return (
    <ul className="space-y-2">
      {organizations.map((organization) => (
        <li key={organization.id}>
          <Link
            to={`/org/${organization.id}`}
            className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2.5 transition-colors duration-(--duration-fast) outline-none hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Building2Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{organization.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {primaryRoleLabel(organization)}
              </span>
            </span>
            <ArrowRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  )
}

export function OrganizationsSettingsPage() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Your organizations</CardTitle>
          <CardDescription>The organizations you're an active member of.</CardDescription>
        </CardHeader>
        <CardContent>
          <MyOrganizations />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Add an organization</CardTitle>
          <CardDescription>
            Start a new one for your team, or ask to join an existing one.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/organizations/new">
              <PlusIcon data-icon="inline-start" />
              Create an organization
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/organizations/join">
              <UsersRoundIcon data-icon="inline-start" />
              Join an organization
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
