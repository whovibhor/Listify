import { useState } from 'react'
import {
  BellIcon,
  Building2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MenuIcon,
  UserRoundIcon,
} from 'lucide-react'
import { Link, Navigate, Outlet, useLocation, useSearchParams } from 'react-router'
import { toast } from 'sonner'

import { SidebarNav } from '@/components/layout/SidebarNav'
import { UserMenu } from '@/components/layout/UserMenu'
import { WorkspaceButton } from '@/components/layout/WorkspaceButton'
import { Logo, LogoMark } from '@/components/shared/Logo'
import { ThemeSync } from '@/components/theme/ThemeSync'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useMe, useUpdatePreferences } from '@/features/auth/api'
import { useWorkspaceInbox } from '@/features/inbox/use-workspace-inbox'
import { primaryRoleLabel } from '@/features/organizations/permissions'
import {
  useActiveOrganization,
  useRememberWorkspace,
} from '@/features/organizations/use-current-org'
import { cn } from '@/lib/utils'

/** Names the workspace you're in; the header button only offers the one you can swap to. */
function CurrentWorkspace({ collapsed = false }: { collapsed?: boolean }) {
  const active = useActiveOrganization()
  const name = active?.name ?? 'Personal'
  const Icon = active ? Building2Icon : UserRoundIcon
  const icon = (
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground">
      <Icon aria-hidden className="size-4" />
    </span>
  )

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-label={`Current workspace: ${name}`}
            className="mx-auto rounded-lg"
          >
            {icon}
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">{name}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <div className="flex min-w-0 items-center gap-2.5 px-1">
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {active ? primaryRoleLabel(active) : 'Private workspace'}
        </span>
      </span>
    </div>
  )
}

/** Tasks used to open in a panel at `?task=ID`, and old links and bookmarks still say so. */
function PageOutlet() {
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const taskId = Number(params.get('task'))
  if (!taskId) return <Outlet />
  const organizationId = /^\/org\/(\d+)/.exec(pathname)?.[1]
  const to = organizationId ? `/org/${organizationId}/tasks` : '/personal/tasks'
  return <Navigate to={`${to}/${taskId}`} replace />
}

function SidebarToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar'
  const Icon = collapsed ? ChevronRightIcon : ChevronLeftIcon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="absolute top-3 -right-3 z-40 grid size-6 place-items-center rounded-full bg-card text-muted-foreground shadow-card transition-colors duration-(--duration-fast) outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Icon aria-hidden className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { path: inboxPath, waiting: unread } = useWorkspaceInbox()
  const { data: user } = useMe()
  const savePreferences = useUpdatePreferences()
  const active = useActiveOrganization()
  const home = active ? `/org/${active.id}` : '/'
  const collapsed = user?.sidebar_collapsed ?? false
  useRememberWorkspace()

  const toggleSidebar = () =>
    savePreferences.mutate(
      { sidebar_collapsed: !collapsed },
      { onError: () => toast.error("Couldn't save your sidebar choice. Please try again.") },
    )

  return (
    <div className="flex min-h-svh bg-background">
      <ThemeSync />
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar (lg and up). Smaller screens use the sheet below. */}
      <aside
        className={cn(
          'sticky top-0 z-40 hidden h-svh shrink-0 flex-col gap-3 border-r border-sidebar-border bg-sidebar py-3 transition-[width] duration-(--duration-base) lg:flex',
          collapsed ? 'w-14 px-1.5' : 'w-60 px-2',
        )}
      >
        <Link
          to={home}
          aria-label="Denote home"
          className={cn(
            'rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
            collapsed ? 'mx-auto' : 'px-1.5',
          )}
        >
          {collapsed ? <LogoMark /> : <Logo />}
        </Link>
        <SidebarToggle collapsed={collapsed} onToggle={toggleSidebar} />
        <div className="-mx-1 flex min-h-0 flex-1 [scrollbar-width:thin] flex-col gap-3 overflow-y-auto px-1 pb-1">
          <CurrentWorkspace collapsed={collapsed} />
          <SidebarNav instanceId="desktop" collapsed={collapsed} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur supports-backdrop-filter:bg-background/70 sm:px-5">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label="Open navigation"
              >
                <MenuIcon />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 gap-0 bg-sidebar p-0">
              <SheetHeader className="border-b border-sidebar-border">
                <SheetTitle asChild>
                  <span>
                    <Logo />
                  </span>
                </SheetTitle>
                <SheetDescription className="sr-only">Main navigation</SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-3 overflow-y-auto px-2 py-3">
                <CurrentWorkspace />
                <SidebarNav instanceId="mobile" onNavigate={() => setMobileNavOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>

          <Link
            to={home}
            aria-label="Denote home"
            className="shrink-0 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:hidden"
          >
            <Logo />
          </Link>

          <div className="ml-auto flex min-w-0 items-center gap-1">
            <div className="mr-1 flex min-w-0">
              <WorkspaceButton />
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" asChild>
                  <Link
                    to={inboxPath}
                    className="relative"
                    aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
                  >
                    <BellIcon />
                    {unread ? (
                      <span
                        aria-hidden
                        className="absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[0.625rem] font-semibold text-primary-foreground tabular-nums"
                      >
                        {unread > 99 ? '99+' : unread}
                      </span>
                    ) : null}
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Notifications</TooltipContent>
            </Tooltip>
            <UserMenu />
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
          <div className="mx-auto w-full max-w-[120rem] px-4 py-4 sm:px-5">
            <PageOutlet />
          </div>
        </main>
      </div>
    </div>
  )
}
