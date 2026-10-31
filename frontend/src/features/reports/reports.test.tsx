import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { MyOrganization } from '@/features/organizations/types'
import type {
  DepartmentDashboard,
  MemberSummary,
  OrganizationDashboard,
} from '@/features/reports/types'
import { emptyPage, mockApi, signedInRoutes, testUser } from '@/test/mock-api'
import { jsonResponse, renderApp } from '@/test/render'

// These pages load the chart library on demand. On a slow first run that alone can outlast a
// test's wait for the page, so it's loaded before the tests start.
beforeAll(() => import('recharts'), 30_000)
afterEach(() => vi.unstubAllGlobals())

const REPORTS = ['report.view_personal', 'report.view_department', 'report.view_organization']

function makeOrg(overrides: Partial<MyOrganization> = {}): MyOrganization {
  return {
    id: 7,
    name: 'Acme',
    slug: 'acme',
    description: null,
    website: null,
    location: null,
    timezone: 'Asia/Kolkata',
    is_discoverable: false,
    review_required: false,
    created_at: '2026-10-30T09:00:00Z',
    role_keys: ['owner'],
    permissions: [...REPORTS, 'member.view'],
    department_permissions: {},
    department_ids: [3],
    ...overrides,
  }
}

const period = {
  start: '2026-10-01',
  end: '2026-10-30',
  timezone: 'Asia/Kolkata',
  generated_at: '2026-10-29T20:00:00Z',
}

const definitions = {
  open: 'Tasks not Completed or Cancelled.',
  on_time: 'Cohort: tasks completed in the period that had a deadline.',
  period: 'Every calendar day in the period.',
  departments: 'Completed uses the department at completion.',
  trend: 'Completed uses the department at completion.',
  by_assignee: 'A count of work, not a measure of performance.',
  not_a_score: 'These are counts of work.',
}

const organizationReport: OrganizationDashboard = {
  period,
  counts: { open: 12, overdue: 3, blocked: 2, completed: 8, created: 9 },
  on_time: { eligible: 4, on_time: 3, rate: 0.75 },
  trend: [
    { date: '2026-10-29', completed: 2, created: 1 },
    { date: '2026-10-30', completed: 6, created: 8 },
  ],
  departments: [
    { id: 3, name: 'Sales', archived: false, open: 7, overdue: 1, blocked: 2, completed: 5 },
    {
      id: null,
      name: 'No department',
      archived: false,
      open: 5,
      overdue: 2,
      blocked: 0,
      completed: 3,
    },
  ],
  definitions,
}

const departmentReport: DepartmentDashboard = {
  period,
  department: { id: 3, name: 'Sales' },
  archived: false,
  counts: { open: 7, overdue: 1, blocked: 2, completed: 5, created: 4 },
  on_time: { eligible: 0, on_time: 0, rate: null },
  trend: organizationReport.trend,
  by_status: { not_started: 4, in_progress: 1, blocked: 2, in_review: 0 },
  by_assignee: [
    {
      user: { id: 5, name: 'Eve' },
      in_department: true,
      open: 3,
      overdue: 1,
      blocked: 0,
      completed: 2,
    },
    {
      user: { id: 6, name: 'Moved Away' },
      in_department: false,
      open: 1,
      overdue: 0,
      blocked: 0,
      completed: 0,
    },
    { user: null, in_department: false, open: 3, overdue: 0, blocked: 2, completed: 0 },
  ],
  overdue_tasks: [
    {
      id: 41,
      title: 'Renew the contract',
      status: 'in_progress',
      assignee: { id: 5, name: 'Eve' },
      due_at: '2026-10-20T18:29:59Z',
      due_all_day: true,
      completed_at: null,
    },
  ],
  blocked_tasks: [],
  recent_completions: [],
  definitions,
}

const memberSummary: MemberSummary = {
  period,
  member: {
    user_id: 1,
    name: 'Ada Lovelace',
    job_title: 'Engineer',
    status: 'active',
    departments: [{ id: 3, name: 'Sales' }],
  },
  is_self: true,
  counts: { assigned: 4, overdue: 1, blocked: 1, completed: 6, pending_update_requests: 2 },
  by_status: { not_started: 2, in_progress: 1, blocked: 1, in_review: 0 },
  by_priority: { urgent: 1, high: 1, medium: 2, low: 0 },
  by_department: [{ id: 3, name: 'Sales', open: 4 }],
  definitions,
}

function routes(org: MyOrganization, extra: Record<string, unknown> = {}) {
  return signedInRoutes({
    'GET /me/organizations': [org],
    'GET /organizations/7/departments': [],
    'GET /organizations/7/dashboard': organizationReport,
    'GET /organizations/7/reports/members': {
      ...emptyPage([
        { user_id: 5, name: 'Eve', status: 'active', open: 3, overdue: 1, completed: 2 },
        { user_id: 6, name: 'Sam', status: 'suspended', open: 0, overdue: 0, completed: 1 },
      ]),
    },
    'GET /organizations/7/reports/departments': organizationReport.departments.slice(0, 1),
    'GET /organizations/7/departments/3/dashboard': departmentReport,
    'GET /organizations/7/members/1/summary': memberSummary,
    ...extra,
  })
}

describe('Organization report', () => {
  it('shows the numbers, what they cover and how they are worked out', async () => {
    mockApi(routes(makeOrg()))
    const { user } = renderApp('/org/7/reports')

    expect(await screen.findByText('75%')).toBeInTheDocument()
    expect(screen.getByText('3 of 4 tasks with a deadline')).toBeInTheDocument()
    expect(
      screen.getByText(/1 Oct 2026 – 30 Oct 2026 · times in Asia\/Kolkata/),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /overdue/i })).toHaveAttribute(
      'href',
      '/org/7/tasks?overdue=true',
    )

    await user.hover(screen.getByRole('button', { name: 'How “On-time rate” is calculated' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/Cohort: tasks completed/)

    const departments = screen.getByRole('table', { name: /each department/ })
    expect(within(departments).getByRole('link', { name: 'Sales' })).toHaveAttribute(
      'href',
      '/org/7/reports/departments/3',
    )
    // Work outside any department has no page of its own.
    expect(within(departments).getByText('No department')).toBeInTheDocument()
    expect(within(departments).queryByRole('link', { name: 'No department' })).toBeNull()

    const people = await screen.findByRole('table', { name: /each member/ })
    expect(within(people).getByRole('link', { name: 'Eve' })).toHaveAttribute(
      'href',
      '/org/7/reports/members/5',
    )
    expect(within(people).getByText('Suspended')).toBeInTheDocument()
  })

  it('offers the trend as a table', async () => {
    mockApi(routes(makeOrg()))
    const { user } = renderApp('/org/7/reports')

    await user.click(await screen.findByRole('button', { name: 'Show table' }))
    const table = screen
      .getAllByRole('table')
      .find((candidate) => within(candidate).queryByText('Day'))
    expect(table).toBeDefined()
    expect(within(table!).getAllByRole('row')).toHaveLength(3)
  })

  it('says so when nothing happened rather than drawing an empty chart', async () => {
    mockApi(
      routes(makeOrg(), {
        'GET /organizations/7/dashboard': {
          ...organizationReport,
          trend: [{ date: '2026-10-30', completed: 0, created: 0 }],
        },
      }),
    )
    renderApp('/org/7/reports')
    expect(
      await screen.findByText('No tasks were created or completed in this period.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show table' })).toBeDisabled()
  })

  it('asks for the chosen period and carries it to the next report', async () => {
    const { calls } = mockApi(routes(makeOrg()))
    const { user } = renderApp('/org/7/reports')
    await screen.findByText('75%')

    await user.click(screen.getByRole('radio', { name: '7 days' }))
    await waitFor(() => {
      const last = calls.filter((call) => call.path === '/organizations/7/dashboard').at(-1)
      expect(last?.query.get('end')).toBeNull()
      expect(last?.query.get('start')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Sales' })).toHaveAttribute(
        'href',
        '/org/7/reports/departments/3?range=7d',
      ),
    )
  })

  it('sends custom dates exactly as chosen', async () => {
    const { calls } = mockApi(routes(makeOrg()))
    const { user } = renderApp('/org/7/reports')
    await screen.findByText('75%')

    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    const from = screen.getByLabelText('From')
    await user.clear(from)
    await user.type(from, '2026-09-01')
    const to = screen.getByLabelText('To')
    await user.clear(to)
    await user.type(to, '2026-09-30')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => {
      const last = calls.filter((call) => call.path === '/organizations/7/dashboard').at(-1)
      expect(last?.query.get('start')).toBe('2026-09-01')
      expect(last?.query.get('end')).toBe('2026-09-30')
    })
  })

  it('shows why a period was refused', async () => {
    mockApi(
      routes(makeOrg(), {
        'GET /organizations/7/dashboard': () =>
          jsonResponse(
            {
              error: {
                code: 'validation_error',
                message: 'Choose a period of 366 days or fewer.',
                details: [],
                request_id: null,
              },
            },
            422,
          ),
      }),
    )
    renderApp('/org/7/reports?start=2024-01-01&end=2026-01-01')
    expect(await screen.findByText('Choose a period of 366 days or fewer.')).toBeInTheDocument()
  })

  it('tells you when an export is refused instead of saving the error', async () => {
    const createObjectUrl = vi.fn()
    Object.assign(URL, { createObjectURL: createObjectUrl })
    mockApi(
      routes(makeOrg(), {
        'GET /organizations/7/reports/tasks.csv': () =>
          jsonResponse(
            {
              error: {
                code: 'export_too_large',
                message: 'Export one department or choose a shorter period.',
                details: [],
                request_id: null,
              },
            },
            422,
          ),
      }),
    )
    const { user } = renderApp('/org/7/reports')
    await user.click(await screen.findByRole('button', { name: 'Export CSV' }))
    expect(
      await screen.findByText('Export one department or choose a shorter period.'),
    ).toBeInTheDocument()
    expect(createObjectUrl).not.toHaveBeenCalled()
  })

  it('downloads the export for the period on screen', async () => {
    const createObjectUrl = vi.fn(() => 'blob:report')
    Object.assign(URL, { createObjectURL: createObjectUrl, revokeObjectURL: vi.fn() })
    const clicks: string[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this.download)
    })
    const { calls } = mockApi(
      routes(makeOrg(), {
        'GET /organizations/7/reports/tasks.csv': () =>
          new Response('"Task ID"', {
            headers: {
              'Content-Type': 'text/csv',
              'Content-Disposition': 'attachment; filename="denote-tasks-a-to-b.csv"',
            },
          }),
      }),
    )
    const { user } = renderApp('/org/7/reports')
    await user.click(await screen.findByRole('button', { name: 'Export CSV' }))

    await waitFor(() => expect(clicks).toEqual(['denote-tasks-a-to-b.csv']))
    const request = calls.find((call) => call.path.endsWith('tasks.csv'))
    expect(request?.query.get('start')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    click.mockRestore()
  })
})

describe('Who sees which report', () => {
  it('sends a member to their own summary', async () => {
    const member = makeOrg({ role_keys: ['member'], permissions: ['report.view_personal'] })
    mockApi(routes(member))
    renderApp('/org/7/reports')

    expect(await screen.findByRole('heading', { level: 1, name: 'My summary' })).toBeInTheDocument()
    expect(await screen.findByText('Engineer · Sales')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull()
  })

  it('offers a team lead their own departments', async () => {
    const lead = makeOrg({
      role_keys: ['team_lead'],
      permissions: ['report.view_personal'],
      department_permissions: { '3': ['report.view_department'] },
    })
    const { calls } = mockApi(routes(lead))
    renderApp('/org/7/reports')

    expect(await screen.findByRole('link', { name: 'Sales' })).toBeInTheDocument()
    expect(screen.getByText('Counts include only tasks you can see.')).toBeInTheDocument()
    expect(calls.some((call) => call.path === '/organizations/7/dashboard')).toBe(false)
  })
})

describe('Department report', () => {
  it('lists the work and links only to people who can be opened', async () => {
    mockApi(routes(makeOrg()))
    renderApp('/org/7/reports/departments/3')

    expect(await screen.findByRole('heading', { level: 1, name: 'Sales' })).toBeInTheDocument()
    expect(await screen.findByText('Renew the contract')).toBeInTheDocument()
    expect(screen.getByText('Nothing is blocked.')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument() // no rate without a cohort

    const people = screen.getByRole('table', { name: /each person/ })
    expect(within(people).getByRole('link', { name: 'Eve' })).toBeInTheDocument()
    expect(within(people).getByText('Moved Away')).toBeInTheDocument()
    expect(within(people).queryByRole('link', { name: 'Moved Away' })).toBeNull()
    expect(within(people).getByText('Unassigned')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Renew the contract/ })).toHaveAttribute(
      'href',
      '/org/7/tasks?task=41',
    )
  })

  it('shows the export for that department', async () => {
    mockApi(routes(makeOrg()))
    renderApp('/org/7/reports/departments/3')
    expect(await screen.findByRole('button', { name: 'Export CSV' })).toBeInTheDocument()
  })
})

describe('Member summary', () => {
  it('shows work, never a score', async () => {
    mockApi(routes(makeOrg()))
    renderApp(`/org/7/reports/members/${testUser.id}`)

    expect(await screen.findByText('Update requests')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /update requests/i })).toHaveAttribute('href', '/inbox')
    expect(screen.getByRole('list', { name: 'Open tasks by department' })).toBeInTheDocument()
    expect(screen.queryByText('On-time rate')).toBeNull()
    expect(screen.getByText('These are counts of work.')).toBeInTheDocument()
  })

  it('names the person when it is someone else', async () => {
    mockApi(
      routes(makeOrg(), {
        'GET /organizations/7/members/5/summary': {
          ...memberSummary,
          is_self: false,
          member: { ...memberSummary.member, user_id: 5, name: 'Eve' },
        },
      }),
    )
    renderApp('/org/7/reports/members/5')

    expect(await screen.findByRole('heading', { level: 1, name: 'Eve' })).toBeInTheDocument()
    expect(screen.getByText(/assigned tasks you can see/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /update requests/i })).toBeNull()
  })
})

describe('Overview', () => {
  it('shows the organization at a glance to people who can report on it', async () => {
    mockApi(routes(makeOrg(), { 'GET /organizations/7/members': emptyPage() }))
    renderApp('/org/7')

    expect(await screen.findByRole('heading', { name: 'Work at a glance' })).toBeInTheDocument()
    expect(await screen.findByText('12')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open reports/ })).toHaveAttribute(
      'href',
      '/org/7/reports',
    )
  })

  it('shows a member their own work, without organization figures', async () => {
    const member = makeOrg({ role_keys: ['member'], permissions: ['report.view_personal'] })
    const { calls } = mockApi(routes(member, { 'GET /organizations/7/members': emptyPage() }))
    renderApp('/org/7')

    expect(await screen.findByRole('heading', { name: 'Your work' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Assigned to you/ })).toBeInTheDocument()
    expect(calls.some((call) => call.path === '/organizations/7/dashboard')).toBe(false)
  })
})
