import { motion } from 'motion/react'
import { Building2Icon, ShieldCheckIcon, UserRoundIcon } from 'lucide-react'
import { NavLink, Outlet } from 'react-router'

import { PageHeader } from '@/components/shared/PageHeader'
import { pageEnter } from '@/lib/motion'
import { cn } from '@/lib/utils'

const tabs = [
  { to: '/settings/profile', label: 'Profile', icon: UserRoundIcon },
  { to: '/settings/security', label: 'Security', icon: ShieldCheckIcon },
  { to: '/settings/organizations', label: 'Organizations', icon: Building2Icon },
]

export function SettingsLayout() {
  return (
    <motion.div {...pageEnter} className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Account settings"
        description="Manage your profile, sign-in security and organizations."
      />
      <nav aria-label="Settings" className="flex gap-1 overflow-x-auto border-b">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              cn(
                '-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-(--duration-fast) outline-none',
                'focus-visible:ring-3 focus-visible:ring-ring/50',
                isActive
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )
            }
          >
            <tab.icon aria-hidden className="size-4" />
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </motion.div>
  )
}
