import {
  Building2Icon,
  CheckIcon,
  ChevronsUpDownIcon,
  PlusIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from 'lucide-react'
import { useNavigate } from 'react-router'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useMyOrganizations } from '@/features/organizations/api'
import { primaryRoleLabel } from '@/features/organizations/permissions'
import { useActiveOrganization } from '@/features/organizations/use-current-org'

/**
 * Personal workspace plus the organizations the API says the user actively belongs to
 * (FR-AUTH-05): pending, suspended or removed memberships are never listed.
 */
export function WorkspaceSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate()
  const { data: organizations = [] } = useMyOrganizations()
  const active = useActiveOrganization()

  const go = (path: string) => {
    navigate(path)
    onNavigate?.()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2.5 rounded-lg bg-card px-2.5 py-2 text-left shadow-card transition-colors duration-(--duration-fast) outline-none hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:bg-accent/50"
        aria-label={`Switch workspace, current: ${active?.name ?? 'Personal'}`}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-secondary text-secondary-foreground">
          {active ? (
            <Building2Icon aria-hidden className="size-4" />
          ) : (
            <UserRoundIcon aria-hidden className="size-4" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{active?.name ?? 'Personal'}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {active ? primaryRoleLabel(active) : 'Private workspace'}
          </span>
        </span>
        <ChevronsUpDownIcon aria-hidden className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-(--radix-dropdown-menu-trigger-width) min-w-64"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => go('/')}>
            <UserRoundIcon aria-hidden />
            Personal
            {active ? null : <CheckIcon aria-label="Current workspace" className="ml-auto" />}
          </DropdownMenuItem>
          {organizations.map((organization) => (
            <DropdownMenuItem key={organization.id} onSelect={() => go(`/org/${organization.id}`)}>
              <Building2Icon aria-hidden />
              <span className="min-w-0 flex-1 truncate">{organization.name}</span>
              {active?.id === organization.id ? (
                <CheckIcon aria-label="Current workspace" className="ml-auto" />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => go('/organizations/new')}>
          <PlusIcon aria-hidden />
          Create an organization
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => go('/organizations/join')}>
          <UsersRoundIcon aria-hidden />
          Join an organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
