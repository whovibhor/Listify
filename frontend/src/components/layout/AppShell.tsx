import { useState } from 'react'
import { BellIcon, MenuIcon } from 'lucide-react'
import { Link, Outlet } from 'react-router'

import { SidebarNav } from '@/components/layout/SidebarNav'
import { UserMenu } from '@/components/layout/UserMenu'
import { WorkspaceSwitcher } from '@/components/layout/WorkspaceSwitcher'
import { Logo } from '@/components/shared/Logo'
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
import { useInboxSummary } from '@/features/inbox/api'

function SidebarContents({
  instanceId,
  onNavigate,
}: {
  instanceId: string
  onNavigate?: () => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <WorkspaceSwitcher onNavigate={onNavigate} />
      <SidebarNav instanceId={instanceId} onNavigate={onNavigate} />
    </div>
  )
}

export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { data: inbox } = useInboxSummary()
  const unread = (inbox?.unread ?? 0) + (inbox?.pending_update_requests ?? 0)

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
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar px-3 py-4 lg:flex">
        <Link
          to="/"
          className="rounded-md px-1.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Logo />
        </Link>
        <SidebarContents instanceId="desktop" />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur supports-backdrop-filter:bg-background/70 sm:px-6">
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
              <div className="overflow-y-auto px-3 py-4">
                <SidebarContents instanceId="mobile" onNavigate={() => setMobileNavOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>

          <Link
            to="/"
            className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:hidden"
          >
            <Logo />
          </Link>

          <div className="ml-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" asChild>
                  <Link
                    to="/inbox"
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
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
