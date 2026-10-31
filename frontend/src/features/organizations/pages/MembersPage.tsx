import { motion } from 'motion/react'
import { Navigate } from 'react-router'

import { PageHeader } from '@/components/shared/PageHeader'
import { DepartmentTabs } from '@/features/organizations/components/DepartmentTabs'
import { MemberDirectory } from '@/features/organizations/components/MemberDirectory'
import { isOrganizationAdmin } from '@/features/organizations/permissions'
import { useOrg } from '@/features/organizations/use-current-org'
import { pageEnter } from '@/lib/motion'

/** Everyone in the organization. Other people see their colleagues on their department page. */
export function MembersPage() {
  const org = useOrg()
  if (!isOrganizationAdmin(org)) return <Navigate to={`/org/${org.id}/departments`} replace />

  return (
    <motion.div {...pageEnter} className="space-y-4">
      <PageHeader title="All members" description="Everyone in this organization." />
      <DepartmentTabs organizationId={org.id} />
      <MemberDirectory />
    </motion.div>
  )
}
