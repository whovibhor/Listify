import type { Department } from '@/features/organizations/types'
import type { TaskPriority, TaskStatus } from '@/features/tasks/task-meta'

export interface ReportPeriod {
  start: string
  end: string
  timezone: string
  generated_at: string
}

export interface ReportCounts {
  open: number
  overdue: number
  blocked: number
  completed: number
  created: number
}

export interface OnTime {
  eligible: number
  on_time: number
  rate: number | null
}

export interface TrendPoint {
  date: string
  completed: number
  created: number
}

export interface DepartmentSummary {
  period: ReportPeriod
  department: Department
  managers: { id: number; name: string }[]
  counts: ReportCounts
  trend: TrendPoint[]
  definitions: Record<string, string>
}

export interface DepartmentWorkload {
  id: number | null
  name: string
  archived: boolean
  open: number
  overdue: number
  blocked: number
  completed: number
}

export interface OrganizationDashboard {
  period: ReportPeriod
  counts: ReportCounts
  on_time: OnTime
  trend: TrendPoint[]
  departments: DepartmentWorkload[]
  definitions: Record<string, string>
}

export interface PersonRef {
  id: number
  name: string
}

export interface AssigneeWorkload {
  user: PersonRef | null
  in_department: boolean
  open: number
  overdue: number
  blocked: number
  completed: number
}

export interface ReportTask {
  id: number
  title: string
  status: TaskStatus
  assignee: PersonRef | null
  due_at: string | null
  due_all_day: boolean
  completed_at: string | null
}

export interface DepartmentDashboard {
  period: ReportPeriod
  department: { id: number; name: string }
  archived: boolean
  counts: ReportCounts
  on_time: OnTime
  trend: TrendPoint[]
  by_status: Record<string, number>
  by_assignee: AssigneeWorkload[]
  overdue_tasks: ReportTask[]
  blocked_tasks: ReportTask[]
  recent_completions: ReportTask[]
  definitions: Record<string, string>
}

export interface MemberActivity {
  user_id: number
  name: string
  status: 'active' | 'suspended'
  open: number
  overdue: number
  completed: number
}

export interface MemberSummary {
  period: ReportPeriod
  member: {
    user_id: number
    name: string
    job_title: string | null
    status: 'active' | 'suspended'
    departments: { id: number; name: string }[]
  }
  is_self: boolean
  counts: {
    assigned: number
    overdue: number
    blocked: number
    completed: number
    pending_update_requests: number
  }
  by_status: Record<string, number>
  by_priority: Record<TaskPriority, number>
  by_department: { id: number | null; name: string; open: number }[]
  definitions: Record<string, string>
}
