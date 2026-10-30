import {
  BriefcaseIcon,
  Building2Icon,
  InboxIcon,
  KanbanIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  MailPlusIcon,
  ScrollTextIcon,
  SettingsIcon,
  UserPlusIcon,
  UsersRoundIcon,
} from 'lucide-react'

import { personalNavigation, type NavItem, type NavSection } from '@/components/layout/navigation'
import { useDepartments, useMembershipRequests } from '@/features/organizations/api'
import { can, canAnywhere } from '@/features/organizations/permissions'
import type { Department, MyOrganization } from '@/features/organizations/types'
import { useActiveOrganization } from '@/features/organizations/use-current-org'

function organizationSections(
  org: MyOrganization,
  pendingRequests: number,
  departments: Department[],
): NavSection[] {
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
        { label: 'Departments', to: `${base}/departments`, icon: Building2Icon, end: true },
        { label: 'Members', to: `${base}/members`, icon: UsersRoundIcon },
      ],
    },
    {
      label: 'Work',
      items: [
        { label: 'My Work', to: `${base}/my-work`, icon: BriefcaseIcon },
        { label: 'Team Tasks', to: `${base}/tasks`, icon: ListChecksIcon },
      ],
    },
    ...(departments.length
      ? [
          {
            label: 'Boards',
            items: departments.map((department) => ({
              label: department.name,
              to: `${base}/departments/${department.id}`,
              icon: KanbanIcon,
            })),
          },
        ]
      : []),
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
  const { data: departments = [] } = useDepartments(org?.id ?? 0, { enabled: org !== null })
  return org ? organizationSections(org, requests?.total ?? 0, departments) : personalNavigation
}
