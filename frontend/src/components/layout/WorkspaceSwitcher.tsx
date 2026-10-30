import { Building2Icon, CheckIcon, ChevronsUpDownIcon, UserRoundIcon } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * Lists the personal workspace and (from Phase 3) the user's active organizations.
 * Only workspaces returned by the API for the signed-in user will ever be listed (FR-AUTH-05).
 */
export function WorkspaceSwitcher() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2.5 rounded-lg border bg-card px-2.5 py-2 text-left shadow-card transition-colors duration-(--duration-fast) outline-none hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:bg-accent/50"
        aria-label="Switch workspace"
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-secondary text-secondary-foreground">
          <UserRoundIcon aria-hidden className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">Personal</span>
          <span className="block truncate text-xs text-muted-foreground">Private workspace</span>
        </span>
        <ChevronsUpDownIcon aria-hidden className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-(--radix-dropdown-menu-trigger-width) min-w-60"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          <DropdownMenuItem>
            <UserRoundIcon aria-hidden />
            Personal
            <CheckIcon aria-label="Current workspace" className="ml-auto" />
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <Building2Icon aria-hidden />
          <span className="flex flex-col">
            <span>Organizations</span>
            <span className="text-xs text-muted-foreground">Create or join one in Phase 3</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
