import {
  AlarmClockIcon,
  ArrowRightIcon,
  Building2Icon,
  CheckCircle2Icon,
  CircleCheckBigIcon,
  CircleIcon,
  ListTodoIcon,
  MailPlusIcon,
  OctagonPauseIcon,
  SearchCheckIcon,
  UserPlusIcon,
  UsersRoundIcon,
  type LucideIcon,
} from 'lucide-react'
import { motion } from 'motion/react'
import { Link } from 'react-router'

import { PageHeader } from '@/components/shared/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { useMe } from '@/features/auth/api'
import { useDepartments, useMembers, useMembershipRequests } from '@/features/organizations/api'
import { can, canAnywhere, primaryRoleLabel } from '@/features/organizations/permissions'
import type { MyOrganization } from '@/features/organizations/types'
import { useOrg } from '@/features/organizations/use-current-org'
import { useMemberSummary, useOrganizationDashboard } from '@/features/reports/api'
import { StatTile } from '@/features/dashboards/components/StatTile'
import { pageEnter } from '@/lib/motion'
import { cn } from '@/lib/utils'

function ChecklistItem({
  done,
  icon: Icon,
  title,
  description,
  to,
}: {
  done: boolean
  icon: LucideIcon
  title: string
  description: string
  to: string
}) {
  return (
    <li>
      <Link
        to={to}
        className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2.5 transition-colors duration-(--duration-fast) outline-none hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {done ? (
          <CheckCircle2Icon aria-label="Done" className="size-5 shrink-0 text-success" />
        ) : (
          <CircleIcon aria-label="Not done yet" className="size-5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1">
          <span className={cn('block text-sm font-medium', done && 'text-muted-foreground')}>
            {title}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{description}</span>
        </span>
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  )
}

/** The organization's numbers for people who can report on it, otherwise your own. */
function WorkAtAGlance({ org }: { org: MyOrganization }) {
  const base = `/org/${org.id}`
  const wholeOrganization = can(org, 'report.view_organization')
  const { data: me } = useMe()
  const { data: report } = useOrganizationDashboard(org.id, {}, { enabled: wholeOrganization })
  const { data: mine } = useMemberSummary(
    org.id,
    me?.id ?? 0,
    {},
    {
      enabled: !wholeOrganization && Boolean(me),
    },
  )
  const numbers = wholeOrganization
    ? report?.counts
    : mine && { ...mine.counts, open: mine.counts.assigned }

  return (
    <section aria-labelledby="glance-heading" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="glance-heading" className="font-semibold">
          {wholeOrganization ? 'Work at a glance' : 'Your work'}
        </h2>
        <Link
          to={`${base}/reports`}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {wholeOrganization ? 'Open reports' : 'My summary'}
          <ArrowRightIcon aria-hidden className="size-4" />
        </Link>
      </div>
      {numbers ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile
            label={wholeOrganization ? 'Open' : 'Assigned to you'}
            value={numbers.open}
            icon={ListTodoIcon}
            to={wholeOrganization ? `${base}/tasks` : `${base}/my-work`}
          />
          <StatTile
            label="Overdue"
            value={numbers.overdue}
            icon={AlarmClockIcon}
            tone={numbers.overdue > 0 ? 'danger' : 'default'}
          />
          <StatTile label="Blocked" value={numbers.blocked} icon={OctagonPauseIcon} />
          <StatTile
            label="Completed"
            value={numbers.completed}
            icon={CircleCheckBigIcon}
            hint="Last 30 days"
          />
        </div>
      ) : (
        <Skeleton className="h-28 w-full rounded-xl" />
      )}
    </section>
  )
}

export function OrganizationOverviewPage() {
  const org = useOrg()
  const base = `/org/${org.id}`
  const { data: departments = [] } = useDepartments(org.id)
  const { data: members } = useMembers(org.id, { page_size: 1 })
  const canApprove = canAnywhere(org, 'member.approve')
  const { data: pending } = useMembershipRequests(org.id, 'pending', { enabled: canApprove })
  const canManage = can(org, 'member.manage')
  const memberTotal = members?.total ?? 0

  return (
    <motion.div {...pageEnter} className="space-y-6">
      <PageHeader
        title={org.name}
        description={org.description ?? `You’re ${primaryRoleLabel(org)} here.`}
      />

      <WorkAtAGlance org={org} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          label={canManage ? 'Members' : 'People in your departments'}
          value={memberTotal}
          icon={UsersRoundIcon}
          to={`${base}/members`}
        />
        <StatTile
          label={canManage ? 'Departments' : 'Your departments'}
          value={departments.length}
          icon={Building2Icon}
          to={`${base}/departments`}
        />
        {canApprove ? (
          <StatTile
            label="Pending requests"
            value={pending?.total ?? 0}
            icon={UserPlusIcon}
            to={`${base}/requests`}
          />
        ) : (
          <StatTile label="Your role" value={primaryRoleLabel(org)} icon={CheckCircle2Icon} />
        )}
      </div>

      {canManage ? (
        <section
          aria-labelledby="setup-heading"
          className="rounded-2xl bg-card p-4 shadow-card sm:p-5"
        >
          <h2 id="setup-heading" className="font-semibold">
            Set up your organization
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">A few steps to get your team in.</p>
          <ul className="space-y-2">
            <ChecklistItem
              done={departments.length > 0}
              icon={Building2Icon}
              title="Create your departments"
              description="Teams like Engineering or Sales"
              to={`${base}/departments`}
            />
            <ChecklistItem
              done={memberTotal > 1}
              icon={MailPlusIcon}
              title="Invite your team"
              description="Send an email invite or share a link"
              to={`${base}/invitations`}
            />
            <ChecklistItem
              done={org.is_discoverable}
              icon={SearchCheckIcon}
              title="Decide how people can find you"
              description="Allow search by name, or invitation only"
              to={`${base}/settings`}
            />
          </ul>
        </section>
      ) : null}
    </motion.div>
  )
}
