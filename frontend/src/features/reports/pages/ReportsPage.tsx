import { useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, UserRoundIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { Link, Navigate } from 'react-router'

import { PageHeader } from '@/components/shared/PageHeader'
import { ErrorState } from '@/components/shared/StatePanels'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useMe } from '@/features/auth/api'
import { can, canAnywhere } from '@/features/organizations/permissions'
import type { MyOrganization } from '@/features/organizations/types'
import { useOrg } from '@/features/organizations/use-current-org'
import {
  useDepartmentReports,
  useMemberActivity,
  useOrganizationDashboard,
  type ReportRange,
} from '@/features/reports/api'
import {
  ExportButton,
  ReportCard,
  ReportSkeleton,
  ReportTiles,
  StatTable,
  TableLink,
} from '@/features/reports/components/ReportParts'
import { ReportRangePicker, ReportScopeLine } from '@/features/reports/components/ReportRangePicker'
import { ReportTrendChart } from '@/features/reports/components/ReportTrendChart'
import type { DepartmentWorkload, MemberActivity } from '@/features/reports/types'
import { useReportRange } from '@/features/reports/use-report-range'
import { pageEnter } from '@/lib/motion'
import { cn } from '@/lib/utils'

function departmentColumns() {
  return [
    { label: 'Open', value: (row: DepartmentWorkload) => row.open },
    { label: 'Overdue', value: (row: DepartmentWorkload) => row.overdue, wide: true },
    { label: 'Blocked', value: (row: DepartmentWorkload) => row.blocked, wide: true },
    { label: 'Done', value: (row: DepartmentWorkload) => row.completed },
  ]
}

function DepartmentName({
  row,
  base,
  search,
}: {
  row: DepartmentWorkload
  base: string
  search: string
}) {
  if (row.id === null) return row.name
  return (
    <TableLink to={`${base}/reports/departments/${row.id}${search}`}>
      {row.name}
      {row.archived ? ' (archived)' : ''}
    </TableLink>
  )
}

function MemberActivityCard({
  orgId,
  range,
  search,
}: {
  orgId: number
  range: ReportRange
  search: string
}) {
  const [page, setPage] = useState(1)
  const { data, isPending, isError, error, refetch } = useMemberActivity(orgId, range, page)
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1
  const columns = [
    { label: 'Open', value: (row: MemberActivity) => row.open },
    { label: 'Overdue', value: (row: MemberActivity) => row.overdue, wide: true },
    { label: 'Done', value: (row: MemberActivity) => row.completed },
  ]
  return (
    <ReportCard
      title="Member activity"
      description="Listed by name. These count work; they don’t measure anyone’s performance."
    >
      {isPending ? (
        <Skeleton className="h-32 w-full rounded-lg" />
      ) : isError ? (
        <ErrorState message={error.message} onRetry={() => void refetch()} />
      ) : (
        <div className="space-y-3">
          <StatTable
            caption="Open, overdue and completed tasks for each member"
            firstHeader="Member"
            rows={data.items}
            rowKey={(row) => row.user_id}
            name={(row) => (
              <>
                <TableLink to={`/org/${orgId}/reports/members/${row.user_id}${search}`}>
                  {row.name}
                </TableLink>
                {row.status === 'suspended' ? (
                  <span className="block text-xs text-muted-foreground">Suspended</span>
                ) : null}
              </>
            )}
            columns={columns}
          />
          {pageCount > 1 ? (
            <nav aria-label="Member pages" className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground tabular-nums">
                Page {page} of {pageCount}
              </p>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeftIcon data-icon="inline-start" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pageCount}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                  <ChevronRightIcon data-icon="inline-end" />
                </Button>
              </div>
            </nav>
          ) : null}
        </div>
      )}
    </ReportCard>
  )
}

function OrganizationReport({ org }: { org: MyOrganization }) {
  const control = useReportRange(org.timezone)
  const { range, search } = control
  const base = `/org/${org.id}`
  const { data, isPending, isError, error, refetch, isPlaceholderData } = useOrganizationDashboard(
    org.id,
    range,
  )
  const { data: me } = useMe()

  return (
    <motion.div {...pageEnter} className="space-y-4">
      <PageHeader
        title="Reports"
        description={`How work is going across ${org.name}.`}
        actions={
          <>
            {me ? (
              <Button variant="outline" asChild>
                <Link to={`${base}/reports/members/${me.id}${search}`}>
                  <UserRoundIcon data-icon="inline-start" />
                  My summary
                </Link>
              </Button>
            ) : null}
            <ExportButton orgId={org.id} range={range} />
          </>
        }
      />
      <ReportRangePicker control={control} timezone={org.timezone} period={data?.period} />
      {isPending ? (
        <ReportSkeleton />
      ) : isError ? (
        <ErrorState
          title="Couldn’t load this report"
          message={error.message}
          onRetry={() => void refetch()}
        />
      ) : (
        <div className={cn('space-y-6 transition-opacity', isPlaceholderData && 'opacity-60')}>
          <ReportScopeLine period={data.period} scope="all tasks in the organization" />
          <ReportTiles
            counts={data.counts}
            onTime={data.on_time}
            definitions={data.definitions}
            links={{
              open: `${base}/tasks`,
              overdue: `${base}/tasks?overdue=true`,
              blocked: `${base}/tasks?status=blocked`,
            }}
          />
          <ReportCard title="Tasks per day" description={data.definitions.period}>
            <ReportTrendChart trend={data.trend} />
          </ReportCard>
          <ReportCard title="Workload by department" description={data.definitions.departments}>
            {data.departments.length ? (
              <StatTable
                caption="Open, overdue, blocked and completed tasks for each department"
                firstHeader="Department"
                rows={data.departments}
                rowKey={(row) => row.id ?? 'none'}
                name={(row) => <DepartmentName row={row} base={base} search={search} />}
                columns={departmentColumns()}
              />
            ) : (
              <p className="text-sm text-muted-foreground">No departments yet.</p>
            )}
          </ReportCard>
          <MemberActivityCard orgId={org.id} range={range} search={search} />
        </div>
      )}
    </motion.div>
  )
}

/** Team Leads and Department Managers report on their own departments. */
function DepartmentChooser({ org }: { org: MyOrganization }) {
  const control = useReportRange(org.timezone)
  const { range, search } = control
  const base = `/org/${org.id}`
  const { data, isPending, isError, error, refetch } = useDepartmentReports(org.id, range)
  const { data: me } = useMe()

  return (
    <motion.div {...pageEnter} className="space-y-4">
      <PageHeader
        title="Reports"
        description="Choose a department to see how its work is going."
        actions={
          me ? (
            <Button variant="outline" asChild>
              <Link to={`${base}/reports/members/${me.id}${search}`}>
                <UserRoundIcon data-icon="inline-start" />
                My summary
              </Link>
            </Button>
          ) : null
        }
      />
      <ReportRangePicker control={control} timezone={org.timezone} period={undefined} />
      {isPending ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : isError ? (
        <ErrorState
          title="Couldn’t load this report"
          message={error.message}
          onRetry={() => void refetch()}
        />
      ) : (
        <ReportCard title="Your departments" description="Counts include only tasks you can see.">
          <StatTable
            caption="Open, overdue, blocked and completed tasks for each department"
            firstHeader="Department"
            rows={data}
            rowKey={(row) => row.id ?? 'none'}
            name={(row) => <DepartmentName row={row} base={base} search={search} />}
            columns={departmentColumns()}
          />
        </ReportCard>
      )}
    </motion.div>
  )
}

export function ReportsPage() {
  const org = useOrg()
  const { data: me } = useMe()
  if (can(org, 'report.view_organization')) return <OrganizationReport org={org} />
  if (canAnywhere(org, 'report.view_department')) return <DepartmentChooser org={org} />
  if (!me) return null
  return <Navigate to={`/org/${org.id}/reports/members/${me.id}`} replace />
}
