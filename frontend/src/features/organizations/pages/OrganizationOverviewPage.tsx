import {
  ArrowRightIcon,
  Building2Icon,
  CheckCircle2Icon,
  CircleIcon,
  MailPlusIcon,
  SearchCheckIcon,
  UserPlusIcon,
  UsersRoundIcon,
  type LucideIcon,
} from 'lucide-react'
import { motion } from 'motion/react'
import { Link } from 'react-router'

import { PageHeader } from '@/components/shared/PageHeader'
import { useDepartments, useMembers, useMembershipRequests } from '@/features/organizations/api'
import { can, canAnywhere, primaryRoleLabel } from '@/features/organizations/permissions'
import { useOrg } from '@/features/organizations/use-current-org'
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
      ) : (
        <section className="rounded-2xl bg-card p-4 shadow-card sm:p-5">
          <h2 className="font-semibold">Team work is coming next</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Department boards and shared tasks arrive in a coming update. Your personal tasks remain
            private and aren’t visible to this organization.
          </p>
          <Link
            to="/"
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Back to your personal workspace
            <ArrowRightIcon aria-hidden className="size-4" />
          </Link>
        </section>
      )}
    </motion.div>
  )
}
