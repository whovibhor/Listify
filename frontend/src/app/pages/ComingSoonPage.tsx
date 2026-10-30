import { motion } from 'motion/react'
import { ConstructionIcon } from 'lucide-react'
import { useLocation } from 'react-router'

import { allNavItems } from '@/components/layout/navigation'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/StatePanels'
import { pageEnter } from '@/lib/motion'

/** Honest placeholder for routes whose feature has not been built yet. */
export function ComingSoonPage() {
  const { pathname } = useLocation()
  const item = allNavItems.find((navItem) => navItem.to === pathname)
  const title = item?.label ?? 'Coming soon'

  return (
    <motion.div {...pageEnter} className="space-y-6">
      <PageHeader title={title} />
      <EmptyState
        icon={item?.icon ?? ConstructionIcon}
        title="Not available yet"
        description={
          item?.plannedMilestone
            ? `This page is scheduled for ${item.plannedMilestone.replace('M', 'Phase ')} of the roadmap.`
            : 'This page is not part of the current build.'
        }
      />
    </motion.div>
  )
}
