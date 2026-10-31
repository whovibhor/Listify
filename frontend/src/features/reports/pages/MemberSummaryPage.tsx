import {
  AlarmClockIcon,
  CircleCheckBigIcon,
  ListTodoIcon,
  MessageCircleQuestionIcon,
  OctagonPauseIcon,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useParams } from 'react-router'

import { PageHeader } from '@/components/shared/PageHeader'
import { ErrorState } from '@/components/shared/StatePanels'
import { BreakdownBars } from '@/features/dashboards/components/BreakdownBars'
import { StatTile } from '@/features/dashboards/components/StatTile'
import { can, canAnywhere } from '@/features/organizations/permissions'
import { useOrg } from '@/features/organizations/use-current-org'
import { useMemberSummary } from '@/features/reports/api'
import { BackLink, ReportCard, ReportSkeleton } from '@/features/reports/components/ReportParts'
import { ReportRangePicker, ReportScopeLine } from '@/features/reports/components/ReportRangePicker'
import { useReportRange } from '@/features/reports/use-report-range'
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type TaskPriority,
  type TaskStatus,
} from '@/features/tasks/task-meta'
import { pageEnter } from '@/lib/motion'
import { cn } from '@/lib/utils'

const PRIORITIES: TaskPriority[] = ['urgent', 'high', 'medium', 'low']

export function MemberSummaryPage() {
  const org = useOrg()
  const userId = Number(useParams().userId)
  const control = useReportRange(org.timezone)
  const { range, search } = control
  const base = `/org/${org.id}`
  const { data, isPending, isError, error, refetch, isPlaceholderData } = useMemberSummary(
    org.id,
    userId,
    range,
  )
  const canReport =
    can(org, 'report.view_organization') || canAnywhere(org, 'report.view_department')
  const title = data ? (data.is_self ? 'My summary' : data.member.name) : 'Member summary'
  const detail = data
    ? [
        data.member.job_title,
        data.member.departments.map((department) => department.name).join(', '),
        data.member.status === 'suspended' ? 'Suspended' : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined

  return (
    <motion.div {...pageEnter} className="space-y-6">
      {canReport ? <BackLink to={`${base}/reports${search}`}>Reports</BackLink> : null}
      <PageHeader title={title} description={detail} />
      <ReportRangePicker control={control} timezone={org.timezone} period={data?.period} />
      {isPending ? (
        <ReportSkeleton />
      ) : isError ? (
        <ErrorState
          title="Couldn’t load this summary"
          message={error.message}
          onRetry={() => void refetch()}
        />
      ) : (
        <div className={cn('space-y-6 transition-opacity', isPlaceholderData && 'opacity-60')}>
          <ReportScopeLine
            period={data.period}
            scope={data.is_self ? 'tasks assigned to you' : 'assigned tasks you can see'}
          />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatTile
              label="Assigned"
              value={data.counts.assigned}
              icon={ListTodoIcon}
              definition={data.definitions.assigned}
              to={data.is_self ? `${base}/my-work` : undefined}
            />
            <StatTile
              label="Completed"
              value={data.counts.completed}
              icon={CircleCheckBigIcon}
              definition={data.definitions.completed}
            />
            <StatTile
              label="Overdue"
              value={data.counts.overdue}
              icon={AlarmClockIcon}
              tone={data.counts.overdue > 0 ? 'danger' : 'default'}
              definition={data.definitions.overdue}
            />
            <StatTile
              label="Blocked"
              value={data.counts.blocked}
              icon={OctagonPauseIcon}
              definition={data.definitions.blocked}
            />
            <div className="col-span-2 lg:col-span-1">
              <StatTile
                label="Update requests"
                value={data.counts.pending_update_requests}
                icon={MessageCircleQuestionIcon}
                definition={data.definitions.pending_update_requests}
                to={data.is_self ? `/org/${org.id}/inbox` : undefined}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <ReportCard title="Open by status">
              <BreakdownBars
                label="Open tasks by status"
                items={Object.entries(data.by_status).map(([status, value]) => ({
                  key: status,
                  label: STATUS_LABELS[status as TaskStatus],
                  value,
                }))}
              />
            </ReportCard>
            <ReportCard title="Open by priority">
              <BreakdownBars
                label="Open tasks by priority"
                items={PRIORITIES.map((priority) => ({
                  key: priority,
                  label: PRIORITY_LABELS[priority],
                  value: data.by_priority[priority],
                }))}
              />
            </ReportCard>
            <ReportCard title="Open by department">
              {data.by_department.length ? (
                <BreakdownBars
                  label="Open tasks by department"
                  items={data.by_department.map((department) => ({
                    key: String(department.id),
                    label: department.name,
                    value: department.open,
                  }))}
                />
              ) : (
                <p className="text-sm text-muted-foreground">No open tasks.</p>
              )}
            </ReportCard>
          </div>
          <p className="text-xs text-muted-foreground">{data.definitions.not_a_score}</p>
        </div>
      )}
    </motion.div>
  )
}
