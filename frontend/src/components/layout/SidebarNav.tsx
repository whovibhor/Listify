import { motion } from 'motion/react'
import { NavLink } from 'react-router'

import { useWorkspaceNavigation } from '@/components/layout/use-workspace-navigation'
import { transitions } from '@/lib/motion'
import { cn } from '@/lib/utils'

interface SidebarNavProps {
  /** Distinguishes the desktop and mobile instances so the active indicator animates per instance. */
  instanceId: string
  onNavigate?: () => void
}

export function SidebarNav({ instanceId, onNavigate }: SidebarNavProps) {
  const sections = useWorkspaceNavigation()

  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {sections.map((section, index) => (
        <div key={section.label ?? index} className="flex flex-col gap-0.5">
          {section.label ? (
            <h2 className="px-2.5 pb-1 text-[0.7rem] font-semibold tracking-wider text-muted-foreground uppercase">
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
                  className={({ isActive }) =>
                    cn(
                      'group relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium outline-none',
                      'text-sidebar-foreground/80 transition-colors duration-(--duration-fast)',
                      'hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                      'focus-visible:ring-3 focus-visible:ring-sidebar-ring/50',
                      isActive && 'text-sidebar-accent-foreground hover:bg-transparent',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive ? (
                        <motion.span
                          layoutId={`sidebar-active-${instanceId}`}
                          transition={transitions.base}
                          className="absolute inset-0 rounded-lg bg-sidebar-accent"
                          aria-hidden
                        />
                      ) : null}
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
