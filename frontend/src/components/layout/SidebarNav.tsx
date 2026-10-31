import { motion } from 'motion/react'
import { Link, NavLink, matchPath, useLocation } from 'react-router'

import type { NavItem, NavSection } from '@/components/layout/navigation'
import { useWorkspaceNavigation } from '@/components/layout/use-workspace-navigation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { transitions } from '@/lib/motion'
import { cn } from '@/lib/utils'

interface SidebarNavProps {
  /** Distinguishes the desktop and mobile instances so the active indicator animates per instance. */
  instanceId: string
  onNavigate?: () => void
  /** Icons only, for the collapsed desktop sidebar. */
  collapsed?: boolean
}

const itemStyles = (isActive: boolean) =>
  cn(
    'group relative flex items-center rounded-lg text-sm font-medium outline-none',
    'text-sidebar-foreground/80 transition-colors duration-(--duration-fast)',
    'hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
    'focus-visible:ring-3 focus-visible:ring-sidebar-ring/50',
    isActive && 'text-sidebar-accent-foreground hover:bg-transparent',
  )

function ActiveIndicator({ instanceId }: { instanceId: string }) {
  return (
    <motion.span
      layoutId={`sidebar-active-${instanceId}`}
      transition={transitions.base}
      className="absolute inset-0 rounded-lg bg-sidebar-accent"
      aria-hidden
    />
  )
}

function RailDot() {
  return <span aria-hidden className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary" />
}

function RailLink({ item, instanceId }: { item: NavItem; instanceId: string }) {
  const { pathname } = useLocation()
  const end = item.end ?? item.to === '/'
  const isActive = Boolean(matchPath({ path: item.to, end }, pathname))
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A plain class string: the tooltip's trigger can't merge NavLink's class function. */}
        <NavLink
          to={item.to}
          end={end}
          aria-label={item.badge ? `${item.label}, ${item.badge} pending` : item.label}
          className={cn(itemStyles(isActive), 'size-9 justify-center')}
        >
          {isActive ? <ActiveIndicator instanceId={instanceId} /> : null}
          <item.icon aria-hidden className="relative size-4 shrink-0" />
          {item.badge ? <RailDot /> : null}
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}

/** A section such as Boards can be long, so the rail shows it as one icon with a list. */
function RailMenu({ section, instanceId }: { section: NavSection; instanceId: string }) {
  const { pathname } = useLocation()
  const Icon = section.railIcon!
  const label = section.label ?? ''
  const isActive = section.items.some((item) => matchPath({ path: item.to, end: false }, pathname))
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            aria-label={label}
            className={cn(itemStyles(isActive), 'size-9 justify-center')}
          >
            {isActive ? <ActiveIndicator instanceId={instanceId} /> : null}
            <Icon aria-hidden className="relative size-4 shrink-0" />
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="right" align="start" className="w-52">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {section.items.map((item) => (
          <DropdownMenuItem key={item.to} asChild>
            <Link to={item.to}>
              <item.icon aria-hidden />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Rail({ sections, instanceId }: { sections: NavSection[]; instanceId: string }) {
  return (
    <nav aria-label="Main" className="flex flex-col items-center gap-2">
      {sections.map((section, index) => (
        <ul
          key={section.label ?? index}
          className={cn(
            'flex flex-col items-center gap-0.5',
            index > 0 && 'w-full border-t border-sidebar-border pt-2',
          )}
        >
          {section.railIcon ? (
            <li>
              <RailMenu section={section} instanceId={instanceId} />
            </li>
          ) : (
            section.items.map((item) => (
              <li key={item.to}>
                <RailLink item={item} instanceId={instanceId} />
              </li>
            ))
          )}
        </ul>
      ))}
    </nav>
  )
}

export function SidebarNav({ instanceId, onNavigate, collapsed = false }: SidebarNavProps) {
  const sections = useWorkspaceNavigation()

  if (collapsed) return <Rail sections={sections} instanceId={instanceId} />

  return (
    <nav aria-label="Main" className="flex flex-col gap-3">
      {sections.map((section, index) => (
        <div key={section.label ?? index} className="flex flex-col gap-0.5">
          {section.label ? (
            <h2 className="px-2.5 pb-0.5 text-[0.7rem] font-semibold tracking-wider text-muted-foreground uppercase">
              {section.label}
            </h2>
          ) : null}
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end ?? item.to === '/'}
                  onClick={onNavigate}
                  className={({ isActive }) => cn(itemStyles(isActive), 'h-8 gap-2.5 px-2.5')}
                >
                  {({ isActive }) => (
                    <>
                      {isActive ? <ActiveIndicator instanceId={instanceId} /> : null}
                      <item.icon aria-hidden className="relative size-4 shrink-0" />
                      <span className="relative flex-1 truncate">{item.label}</span>
                      {item.plannedMilestone ? (
                        <span className="relative rounded-sm bg-muted px-1 py-px text-[0.65rem] font-medium text-muted-foreground">
                          Soon
                        </span>
                      ) : null}
                      {item.badge ? (
                        <span className="relative min-w-5 rounded-full bg-primary px-1.5 text-center text-[0.7rem] font-semibold text-primary-foreground tabular-nums">
                          <span className="sr-only">Pending: </span>
                          {item.badge}
                        </span>
                      ) : null}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}
