import {
  BriefcaseIcon,
  Building2Icon,
  ChartPieIcon,
  InboxIcon,
  KanbanIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  MailPlusIcon,
  ScrollTextIcon,
  SettingsIcon,
  UserPlusIcon,
} from 'lucide-react'

import { personalNavigation, type NavItem, type NavSection } from '@/components/layout/navigation'
import { useWorkspaceInbox } from '@/features/inbox/use-workspace-inbox'
import { useDepartments, useMembershipRequests } from '@/features/organizations/api'
import { can, canAnywhere, isOrganizationAdmin } from '@/features/organizations/permissions'
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
        { label: 'Inbox', to: `${base}/inbox`, icon: InboxIcon },
        {
          label: isOrganizationAdmin(org) || departments.length > 1 ? 'Departments' : 'Department',
          to: `${base}/departments`,
          icon: Building2Icon,
        },
      ],
    },
    ...(departments.length
      ? [
          {
            label: 'Boards',
            railIcon: KanbanIcon,
            items: departments.map((department) => ({
              label: department.name,
              to: `${base}/boards/${department.id}`,
              icon: KanbanIcon,
            })),
          },
        ]
      : []),
    {
      label: 'Work',
      items: [
        { label: 'My Work', to: `${base}/my-work`, icon: BriefcaseIcon },
        { label: 'Team Tasks', to: `${base}/tasks`, icon: ListChecksIcon },
        { label: 'Reports', to: `${base}/reports`, icon: ChartPieIcon },
      ],
    },
    ...(administration.length ? [{ label: 'Administration', items: administration }] : []),
  ]
}

/** Navigation for the current workspace. Hiding items is a courtesy; the API enforces access. */
export function useWorkspaceNavigation(): NavSection[] {
  const org = useActiveOrganization()
  const { data: requests } = useMembershipRequests(org?.id ?? 0, 'pending', {
    enabled: org ? canAnywhere(org, 'member.approve') : false,
  })
  const { data: departments = [] } = useDepartments(org?.id ?? 0, { enabled: org !== null })
  const inbox = useWorkspaceInbox()
  const sections = org
    ? organizationSections(org, requests?.total ?? 0, departments)
    : personalNavigation
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) =>
      item.to === inbox.path ? { ...item, badge: inbox.waiting } : item,
    ),
  }))
}
