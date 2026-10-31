import { motion } from 'motion/react'
import { useParams } from 'react-router'

import { PageHeader } from '@/components/shared/PageHeader'
import { ErrorState } from '@/components/shared/StatePanels'
import { BreakdownBars } from '@/features/dashboards/components/BreakdownBars'
import { useOrg } from '@/features/organizations/use-current-org'
import { useDepartmentDashboard } from '@/features/reports/api'
import {
  BackLink,
  ExportButton,
  ReportCard,
  ReportSkeleton,
  ReportTaskList,
  ReportTiles,
  StatTable,
  TableLink,
} from '@/features/reports/components/ReportParts'
import { ReportRangePicker, ReportScopeLine } from '@/features/reports/components/ReportRangePicker'
import { ReportTrendChart } from '@/features/reports/components/ReportTrendChart'
import type { AssigneeWorkload } from '@/features/reports/types'
import { useReportRange } from '@/features/reports/use-report-range'
import { STATUS_LABELS, type TaskStatus } from '@/features/tasks/task-meta'
import { pageEnter } from '@/lib/motion'
import { cn } from '@/lib/utils'

const ASSIGNEE_COLUMNS = [
  { label: 'Open', value: (row: AssigneeWorkload) => row.open },
  { label: 'Overdue', value: (row: AssigneeWorkload) => row.overdue, wide: true },
  { label: 'Blocked', value: (row: AssigneeWorkload) => row.blocked, wide: true },
  { label: 'Done', value: (row: AssigneeWorkload) => row.completed },
]

export function DepartmentReportPage() {
  const org = useOrg()
  const departmentId = Number(useParams().departmentId)
  const control = useReportRange(org.timezone)
  const { range, search } = control
  const base = `/org/${org.id}`
  const { data, isPending, isError, error, refetch, isPlaceholderData } = useDepartmentDashboard(
    org.id,
    departmentId,
    range,
  )

  return (
    <motion.div {...pageEnter} className="space-y-6">
      <BackLink to={`${base}/reports${search}`}>Reports</BackLink>
      <PageHeader
        title={data?.department.name ?? 'Department report'}
        description={data?.archived ? 'This department is archived.' : 'Department report.'}
        actions={<ExportButton orgId={org.id} range={range} departmentId={departmentId} />}
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
          <ReportScopeLine period={data.period} scope="tasks you can see" />
          <ReportTiles
            counts={data.counts}
            onTime={data.on_time}
            definitions={data.definitions}
            links={{
              open: `${base}/boards/${departmentId}`,
              overdue: `${base}/boards/${departmentId}?overdue=true`,
            }}
          />
          <ReportCard title="Tasks per day" description={data.definitions.trend}>
            <ReportTrendChart trend={data.trend} />
          </ReportCard>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ReportCard title="Open by status" description="Where the work sits right now.">
              <BreakdownBars
                label="Open tasks by status"
                items={Object.entries(data.by_status).map(([status, value]) => ({
                  key: status,
                  label: STATUS_LABELS[status as TaskStatus],
                  value,
                }))}
              />
            </ReportCard>
            <ReportCard title="By assignee" description={data.definitions.by_assignee}>
              {data.by_assignee.length ? (
                <StatTable
                  caption="Open, overdue, blocked and completed tasks for each person"
                  firstHeader="Assignee"
                  rows={data.by_assignee}
                  rowKey={(row) => row.user?.id ?? 'unassigned'}
                  name={(row) =>
                    row.user && row.in_department ? (
                      <TableLink to={`${base}/reports/members/${row.user.id}${search}`}>
                        {row.user.name}
                      </TableLink>
                    ) : (
                      (row.user?.name ?? 'Unassigned')
                    )
                  }
                  columns={ASSIGNEE_COLUMNS}
                />
              ) : (
                <p className="text-sm text-muted-foreground">No assigned work in this period.</p>
              )}
            </ReportCard>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <ReportCard title="Overdue" description="Oldest deadline first.">
              <ReportTaskList
                tasks={data.overdue_tasks}
                empty="Nothing is overdue."
                orgId={org.id}
                timezone={org.timezone}
              />
            </ReportCard>
            <ReportCard title="Blocked" description="Soonest deadline first.">
              <ReportTaskList
                tasks={data.blocked_tasks}
                empty="Nothing is blocked."
                orgId={org.id}
                timezone={org.timezone}
              />
            </ReportCard>
            <ReportCard title="Recent completions" description="Newest first.">
              <ReportTaskList
                tasks={data.recent_completions}
                empty="Nothing was completed in this period."
                orgId={org.id}
                timezone={org.timezone}
              />
            </ReportCard>
          </div>
        </div>
      )}
    </motion.div>
  )
}
