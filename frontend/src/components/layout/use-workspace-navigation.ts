import {
  Building2Icon,
  InboxIcon,
  LayoutDashboardIcon,
  MailPlusIcon,
  ScrollTextIcon,
  SettingsIcon,
  UserPlusIcon,
  UsersRoundIcon,
} from 'lucide-react'

import { personalNavigation, type NavItem, type NavSection } from '@/components/layout/navigation'
import { useMembershipRequests } from '@/features/organizations/api'
import { can, canAnywhere } from '@/features/organizations/permissions'
import type { MyOrganization } from '@/features/organizations/types'
import { useActiveOrganization } from '@/features/organizations/use-current-org'

function organizationSections(org: MyOrganization, pendingRequests: number): NavSection[] {
  const base = `/org/${org.id}`
  const administration: NavItem[] = []
  if (canAnywhere(org, 'member.approve')) {
    administration.push({
      label: 'Join requests',
      to: `${base}/requests`,
      icon: UserPlusIcon,
      badge: pendingRequests,
    })
  }
  if (can(org, 'member.manage')) {
    administration.push({ label: 'Invitations', to: `${base}/invitations`, icon: MailPlusIcon })
  }
  if (can(org, 'organization.settings.update')) {
    administration.push(
      { label: 'Activity log', to: `${base}/activity`, icon: ScrollTextIcon },
      { label: 'Settings', to: `${base}/settings`, icon: SettingsIcon },
    )
  }
  return [
    {
      items: [
        { label: 'Overview', to: base, icon: LayoutDashboardIcon, end: true },
        { label: 'Departments', to: `${base}/departments`, icon: Building2Icon },
        { label: 'Members', to: `${base}/members`, icon: UsersRoundIcon },
      ],
    },
    ...(administration.length ? [{ label: 'Administration', items: administration }] : []),
    {
      label: 'Inbox',
      items: [{ label: 'Inbox', to: '/inbox', icon: InboxIcon, plannedMilestone: 'M6' }],
    },
  ]
}

/** Navigation for the current workspace. Hiding items is a courtesy; the API enforces access. */
export function useWorkspaceNavigation(): NavSection[] {
  const org = useActiveOrganization()
  const { data: requests } = useMembershipRequests(org?.id ?? 0, 'pending', {
    enabled: org ? canAnywhere(org, 'member.approve') : false,
  })
  return org ? organizationSections(org, requests?.total ?? 0) : personalNavigation
}
