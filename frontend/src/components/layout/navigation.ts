import {
  CalendarClockIcon,
  ChartPieIcon,
  CircleCheckBigIcon,
  HouseIcon,
  InboxIcon,
  ListTodoIcon,
  SunIcon,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  /** Roadmap phase that delivers the page; shown as a "Soon" hint until it ships. */
  plannedMilestone?: string
  /** Match the exact path only (for section roots). */
  end?: boolean
  /** Count shown beside the label, e.g. pending requests. */
  badge?: number
}

export interface NavSection {
  label?: string
  items: NavItem[]
}

// Personal workspace navigation (PRD §4). Organization sections are added in Phase 3
// and will be filtered by the user's effective permissions.
export const personalNavigation: NavSection[] = [
  { items: [{ label: 'Home', to: '/', icon: HouseIcon }] },
  {
    label: 'Personal',
    items: [
      { label: 'My Day', to: '/personal/my-day', icon: SunIcon },
      { label: 'My Tasks', to: '/personal/tasks', icon: ListTodoIcon },
      { label: 'Upcoming', to: '/personal/upcoming', icon: CalendarClockIcon },
      { label: 'Completed', to: '/personal/completed', icon: CircleCheckBigIcon },
      { label: 'Analytics', to: '/personal/analytics', icon: ChartPieIcon },
    ],
  },
  {
    label: 'Inbox',
    items: [{ label: 'Inbox', to: '/inbox', icon: InboxIcon }],
  },
]

export const allNavItems = personalNavigation.flatMap((section) => section.items)
