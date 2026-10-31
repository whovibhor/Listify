import type { ReactNode } from 'react'
import {
  AlarmClockIcon,
  ChartPieIcon,
  CircleCheckBigIcon,
  KanbanIcon,
  ListTodoIcon,
  OctagonPauseIcon,
} from 'lucide-react'
import { motion } from 'motion/react'
import { Link, Navigate, NavLink, useParams, useSearchParams } from 'react-router'

import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { PageHeader } from '@/components/shared/PageHeader'
import { ErrorState } from '@/components/shared/StatePanels'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatTile } from '@/features/dashboards/components/StatTile'
import { useDepartments } from '@/features/organizations/api'
import { DepartmentControls } from '@/features/organizations/components/DepartmentControls'
import { MemberAvatar } from '@/features/organizations/components/MemberAvatar'
import { MemberDirectory } from '@/features/organizations/components/MemberDirectory'
import { can, isOrganizationAdmin } from '@/features/organizations/permissions'
import type { Department } from '@/features/organizations/types'
import { useOrg } from '@/features/organizations/use-current-org'
import { useDepartmentSummary } from '@/features/reports/api'
import { BackLink, ReportCard } from '@/features/reports/components/ReportParts'
import { ReportTrendChart } from '@/features/reports/components/ReportTrendChart'
import { ApiError } from '@/lib/api-client'
import { pageEnter } from '@/lib/motion'
import { cn } from '@/lib/utils'

function DepartmentPicker({
  organizationId,
  departments,
}: {
  organizationId: number
  departments: Department[]
}) {
  return (
    <nav aria-label="Your departments" className="flex flex-wrap gap-1">
      {departments.map((department) => (
        <NavLink
          key={department.id}
          to={`/org/${organizationId}/departments/${department.id}`}
          className={({ isActive }) =>
            cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-(--duration-fast) outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              isActive
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )
          }
        >
          {department.name}
        </NavLink>
      ))}
    </nav>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading department">
      <Skeleton className="h-10 w-1/3" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-2xl" />
    </div>
  )
}

/** One department in full. Everyone in it can open this; what they can do here varies by role. */
export function DepartmentPage() {
  const org = useOrg()
  const departmentId = Number(useParams().departmentId)
  const [params] = useSearchParams()
  const { data, isPending, isError, error, refetch } = useDepartmentSummary(org.id, departmentId)
  const { data: departments = [] } = useDepartments(org.id)
  const base = `/org/${org.id}`
  const board = `${base}/boards/${departmentId}`
  const admin = isOrganizationAdmin(org)

  // This address used to be the board, and links to it carried the board's settings.
  const boardSettings = params.toString()
  if (boardSettings) return <Navigate to={`${board}?${boardSettings}`} replace />
  // Departments the viewer can't open look like they don't exist (BR-006).
  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />
  if (isPending) return <PageSkeleton />
  if (isError) return <ErrorState message={error.message} onRetry={() => void refetch()} />

  const { department, counts, definitions } = data
  const archived = department.status === 'archived'

  return (
    <motion.div {...pageEnter} className="space-y-4">
      {admin ? <BackLink to={`${base}/departments`}>Departments</BackLink> : null}
      {!admin && departments.length > 1 ? (
        <DepartmentPicker organizationId={org.id} departments={departments} />
      ) : null}
      <PageHeader
        title={department.name}
        description={archived ? 'This department is archived.' : department.description}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {can(org, 'department.update', departmentId) ? (
              <DepartmentControls department={department} />
            ) : null}
            {can(org, 'report.view_department', departmentId) ? (
              <Button variant="outline" asChild>
                <Link to={`${base}/reports/departments/${departmentId}`}>
                  <ChartPieIcon data-icon="inline-start" />
                  Report
                </Link>
              </Button>
            ) : null}
            <Button asChild>
              <Link to={board}>
                <KanbanIcon data-icon="inline-start" />
                Open board
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Open"
          value={counts.open}
          icon={ListTodoIcon}
          definition={definitions.open}
          to={board}
        />
        <StatTile
          label="Overdue"
          value={counts.overdue}
          icon={AlarmClockIcon}
          tone={counts.overdue > 0 ? 'danger' : 'default'}
          definition={definitions.overdue}
          to={`${board}?overdue=true`}
        />
        <StatTile
          label="Blocked"
          value={counts.blocked}
          icon={OctagonPauseIcon}
          definition={definitions.blocked}
          to={`${board}?show=blocked`}
        />
        <StatTile
          label="Completed"
          value={counts.completed}
          icon={CircleCheckBigIcon}
          hint="Last 30 days"
          definition={definitions.completed}
        />
      </div>

      {/* minmax(0,…) lets the chart shrink with the page instead of widening it. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <ReportCard title="Tasks per day" description="The last 30 days, for tasks you can see.">
          <ReportTrendChart trend={data.trend} />
        </ReportCard>
        <ReportCard title="About this department">
          <dl className="space-y-2.5">
            <Fact label={data.managers.length === 1 ? 'Manager' : 'Managers'}>
              {data.managers.length ? (
                <ul className="space-y-1.5">
                  {data.managers.map((manager) => (
                    <li key={manager.id} className="flex items-center gap-2">
                      <MemberAvatar name={manager.name} className="size-6 text-[0.625rem]" />
                      <span className="min-w-0 truncate">{manager.name}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-muted-foreground">No manager yet</span>
              )}
            </Fact>
            <Fact label="Members">
              <span className="tabular-nums">{department.member_count}</span>
            </Fact>
            <Fact label="Join requests">
              {department.open_for_join_requests ? 'Open' : 'Closed'}
            </Fact>
          </dl>
        </ReportCard>
      </div>

      <section aria-labelledby="members-heading" className="space-y-3">
        <h2 id="members-heading" className="font-semibold">
          Members
        </h2>
        <MemberDirectory key={departmentId} departmentId={departmentId} />
      </section>
    </motion.div>
  )
}
