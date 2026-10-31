import { NavLink } from 'react-router'

import { cn } from '@/lib/utils'

/** The Owner's and Admins' two views of the organization's people and teams. */
export function DepartmentTabs({ organizationId }: { organizationId: number }) {
  const base = `/org/${organizationId}/departments`
  const tabs = [
    { to: base, label: 'Departments', end: true },
    { to: `${base}/members`, label: 'All members', end: false },
  ]
  return (
    <nav aria-label="Departments and members" className="flex gap-1 border-b">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-(--duration-fast) outline-none',
              'focus-visible:ring-3 focus-visible:ring-ring/50',
              isActive
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
