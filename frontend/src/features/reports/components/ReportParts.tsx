import type { ReactNode } from 'react'
import { format } from 'date-fns'
import {
  AlarmClockIcon,
  ArrowLeftIcon,
  CircleCheckBigIcon,
  DownloadIcon,
  ListTodoIcon,
  OctagonPauseIcon,
  TargetIcon,
} from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { StatTile } from '@/features/dashboards/components/StatTile'
import { useExportReport, type ReportRange } from '@/features/reports/api'
import type { OnTime, ReportCounts, ReportTask } from '@/features/reports/types'
import { TaskLink } from '@/features/tasks/components/TaskLink'
import { inZone } from '@/features/tasks/dates'
import { errorText } from '@/lib/api-client'
import { cn } from '@/lib/utils'

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ArrowLeftIcon aria-hidden className="size-4" />
      {children}
    </Link>
  )
}

export function ReportSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-28 rounded-xl" />
      ))}
      <Skeleton className="col-span-2 h-72 rounded-xl lg:col-span-5" />
    </div>
  )
}

export function ExportButton({
  orgId,
  range,
  departmentId,
}: {
  orgId: number
  range: ReportRange
  departmentId?: number
}) {
  const exportReport = useExportReport(orgId)
  return (
    <Button
      variant="outline"
      disabled={exportReport.isPending}
      onClick={() =>
        exportReport.mutate(
          { ...range, department_id: departmentId },
          { onError: (error) => toast.error(errorText(error)) },
        )
      }
    >
      <DownloadIcon data-icon="inline-start" />
      {exportReport.isPending ? 'Preparing…' : 'Export CSV'}
    </Button>
  )
}

export function ReportTiles({
  counts,
  onTime,
  definitions,
  links = {},
}: {
  counts: ReportCounts
  onTime: OnTime
  definitions: Record<string, string>
  links?: { open?: string; overdue?: string; blocked?: string }
}) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <StatTile
        label="Open"
        value={counts.open}
        icon={ListTodoIcon}
        definition={definitions.open}
        to={links.open}
      />
      <StatTile
        label="Completed"
        value={counts.completed}
        icon={CircleCheckBigIcon}
        definition={definitions.completed}
        hint={`${counts.created} created`}
      />
      <StatTile
        label="Overdue"
        value={counts.overdue}
        icon={AlarmClockIcon}
        tone={counts.overdue > 0 ? 'danger' : 'default'}
        definition={definitions.overdue}
        to={links.overdue}
      />
      <StatTile
        label="Blocked"
        value={counts.blocked}
        icon={OctagonPauseIcon}
        definition={definitions.blocked}
        to={links.blocked}
      />
      <div className="col-span-2 lg:col-span-1">
        <StatTile
          label="On-time rate"
          value={onTime.rate === null ? '—' : `${Math.round(onTime.rate * 100)}%`}
          icon={TargetIcon}
          definition={definitions.on_time}
          hint={
            onTime.eligible
              ? `${onTime.on_time} of ${onTime.eligible} ${onTime.eligible === 1 ? 'task' : 'tasks'} with a deadline`
              : 'None completed with a deadline'
          }
        />
      </div>
    </div>
  )
}

export function ReportCard({
  title,
  description,
  children,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <Card className="min-w-0 shadow-card">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export interface StatColumn<Row> {
  label: string
  value: (row: Row) => number
  /** Headings as long as "Overdue" need a little more room on a phone. */
  wide?: boolean
}

/** A name and a few counts: narrow enough to fit a phone without scrolling sideways. */
export function StatTable<Row>({
  caption,
  firstHeader,
  rows,
  rowKey,
  name,
  columns,
}: {
  caption: string
  firstHeader: string
  rows: Row[]
  rowKey: (row: Row) => string | number
  name: (row: Row) => ReactNode
  columns: StatColumn<Row>[]
}) {
  return (
    <table className="w-full table-fixed text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead className="text-xs text-muted-foreground">
        <tr>
          <th scope="col" className="py-2 pr-2 text-left font-medium">
            {firstHeader}
          </th>
          {columns.map((column) => (
            <th
              key={column.label}
              scope="col"
              className={cn(
                'py-2 pl-1 text-right font-medium sm:w-16',
                column.wide ? 'w-14' : 'w-11',
              )}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)} className="border-t">
            <td className="py-2 pr-2 wrap-anywhere">{name(row)}</td>
            {columns.map((column) => (
              <td key={column.label} className="py-2 pl-1 text-right tabular-nums">
                {column.value(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function TableLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {children}
    </Link>
  )
}

export function ReportTaskList({
  tasks,
  empty,
  orgId,
  timezone,
}: {
  tasks: ReportTask[]
  empty: string
  orgId: number
  timezone: string
}) {
  if (tasks.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <ul className="space-y-1">
      {tasks.map((task) => {
        const when = task.completed_at
          ? `Completed ${format(inZone(task.completed_at, timezone), 'd MMM')}`
          : task.due_at
            ? `Due ${format(inZone(task.due_at, timezone), 'd MMM')}`
            : 'No deadline'
        return (
          <li key={task.id}>
            <TaskLink
              task={{ id: task.id, organization_id: orgId }}
              className="block rounded-lg px-2 py-1.5 outline-none hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="block truncate text-sm font-medium">{task.title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {when} · {task.assignee?.name ?? 'Unassigned'}
              </span>
            </TaskLink>
          </li>
        )
      })}
    </ul>
  )
}
