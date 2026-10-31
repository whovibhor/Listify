import {
  Building2Icon,
  CheckIcon,
  ChevronDownIcon,
  PlusIcon,
  UserRoundIcon,
  UsersRoundIcon,
  type LucideIcon,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useMyOrganizations } from '@/features/organizations/api'
import type { MyOrganization } from '@/features/organizations/types'
import { useActiveOrganization } from '@/features/organizations/use-current-org'

function SwapLink({ to, icon: Icon, label }: { to: string; icon: LucideIcon; label: string }) {
  return (
    <Button variant="outline" size="sm" className="max-w-full min-w-0" asChild>
      <Link to={to} aria-label={`Switch to ${label}`}>
        <Icon data-icon="inline-start" />
        <span className="truncate">{label}</span>
      </Link>
    </Button>
  )
}

/** Shown until the user joins an organization; afterwards this lives in Account settings. */
function StartOrganizationMenu() {
  const navigate = useNavigate()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Join or create organization">
          <Building2Icon data-icon="inline-start" />
          <span className="hidden sm:inline">Join or create organization</span>
          <span className="sm:hidden">Join or create</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => navigate('/organizations/new')}>
          <PlusIcon aria-hidden />
          Create an organization
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/organizations/join')}>
          <UsersRoundIcon aria-hidden />
          Join an organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function WorkspaceMenu({
  organizations,
  active,
}: {
  organizations: MyOrganization[]
  active: MyOrganization | null
}) {
  const navigate = useNavigate()
  const current = active?.name ?? 'Personal'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="max-w-full min-w-0"
          aria-label={`Switch workspace, current: ${current}`}
        >
          {active ? (
            <Building2Icon data-icon="inline-start" />
          ) : (
            <UserRoundIcon data-icon="inline-start" />
          )}
          <span className="truncate">{current}</span>
          <ChevronDownIcon data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => navigate('/')}>
            <UserRoundIcon aria-hidden />
            Personal
            {active ? null : <CheckIcon aria-label="Current workspace" className="ml-auto" />}
          </DropdownMenuItem>
          {organizations.map((organization) => (
            <DropdownMenuItem
              key={organization.id}
              onSelect={() => navigate(`/org/${organization.id}`)}
            >
              <Building2Icon aria-hidden />
              <span className="min-w-0 flex-1 truncate">{organization.name}</span>
              {active?.id === organization.id ? (
                <CheckIcon aria-label="Current workspace" className="ml-auto" />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Swaps between Personal and the organizations the API says the user actively belongs to
 * (FR-AUTH-05): pending, suspended or removed memberships are never offered.
 */
export function WorkspaceButton() {
  const { data: organizations } = useMyOrganizations()
  const active = useActiveOrganization()

  if (!organizations) return null
  if (organizations.length === 0) return <StartOrganizationMenu />
  if (organizations.length > 1) {
    return <WorkspaceMenu organizations={organizations} active={active} />
  }
  const organization = organizations[0]
  return active ? (
    <SwapLink to="/" icon={UserRoundIcon} label="Personal" />
  ) : (
    <SwapLink to={`/org/${organization.id}`} icon={Building2Icon} label={organization.name} />
  )
}
