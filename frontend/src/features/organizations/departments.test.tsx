import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Department, Member, MyOrganization } from '@/features/organizations/types'
import type { DepartmentSummary } from '@/features/reports/types'
import { emptyPage, mockApi, signedInRoutes } from '@/test/mock-api'
import { jsonResponse, renderApp } from '@/test/render'

// The chart library is slow to load the first time.
beforeAll(() => import('recharts'), 30_000)
afterEach(() => vi.unstubAllGlobals())

function department(id: number, name: string): Department {
  return {
    id,
    organization_id: 7,
    name,
    description: `${name} team`,
    status: 'active',
    open_for_join_requests: true,
    member_count: 2,
  }
}

const sales = department(3, 'Sales')
const engineering = department(4, 'Engineering')

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
    role_keys: ['member'],
    permissions: ['member.view'],
    department_permissions: {},
    department_ids: [3],
    ...overrides,
  }
}

const admin = makeOrg({
  role_keys: ['admin'],
  permissions: ['member.view', 'member.manage', 'department.create', 'department.update'],
  department_ids: [],
})

const mia: Member = {
  membership_id: 21,
  user_id: 2,
  name: 'Mia Member',
  email: 'mia@example.com',
  job_title: 'Account Executive',
  status: 'active',
  joined_at: '2026-10-01T09:00:00Z',
  roles: [{ key: 'member', name: 'Member', department_id: null }],
  departments: [{ id: 3, name: 'Sales' }],
  actions: [],
}

function summary(overrides: Partial<DepartmentSummary> = {}): DepartmentSummary {
  return {
    period: {
      start: '2026-10-02',
      end: '2026-10-31',
      timezone: 'Asia/Kolkata',
      generated_at: '2026-10-31T09:00:00Z',
    },
    department: sales,
    managers: [{ id: 9, name: 'Max Manager' }],
    counts: { open: 12, overdue: 3, blocked: 2, completed: 8, created: 5 },
    trend: [{ date: '2026-10-31', completed: 1, created: 2 }],
    definitions: { open: 'Open tasks', overdue: 'Late', blocked: 'Stuck', completed: 'Done' },
    ...overrides,
  }
}

function routes(org: MyOrganization, departments: Department[], extra = {}) {
  return signedInRoutes({
    'GET /me/organizations': [org],
    'GET /organizations/7/departments': departments,
    'GET /organizations/7/members': emptyPage([mia]),
    'GET /organizations/7/membership-requests': emptyPage(),
    'GET /organizations/7/departments/3/summary': summary(),
    'GET /organizations/7/departments/4/summary': summary({ department: engineering }),
    ...extra,
  })
}

const mainNav = async () => (await screen.findAllByRole('navigation', { name: 'Main' }))[0]

describe('a regular member', () => {
  it('finds their department in the sidebar, and no Members item', async () => {
    mockApi(routes(makeOrg(), [sales]))
    const { user, router } = renderApp('/org/7/my-work')

    const nav = await mainNav()
    await user.click(await within(nav).findByRole('link', { name: 'Department' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/org/7/departments/3'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Sales' })).toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: /members/i })).not.toBeInTheDocument()
  })

  it('sees the team totals, the manager and colleagues with their job titles', async () => {
    mockApi(routes(makeOrg(), [sales]))
    renderApp('/org/7/departments/3')

    expect(await screen.findByText('Sales team')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^Open 12/ })).toHaveAttribute(
      'href',
      '/org/7/boards/3',
    )
    expect(screen.getByRole('link', { name: /^Overdue 3/ })).toHaveAttribute(
      'href',
      '/org/7/boards/3?overdue=true',
    )
    expect(screen.getByText('Max Manager')).toBeInTheDocument()
    expect(await screen.findByText('Mia Member')).toBeInTheDocument()
    expect(screen.getByText(/Account Executive/)).toBeInTheDocument()
  })

  it('gets no report or management buttons, and asks only for this department', async () => {
    const api = mockApi(routes(makeOrg(), [sales]))
    renderApp('/org/7/departments/3')

    await screen.findByText('Mia Member')
    expect(screen.getByRole('link', { name: 'Open board' })).toHaveAttribute(
      'href',
      '/org/7/boards/3',
    )
    expect(screen.queryByRole('link', { name: 'Report' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit Sales/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Departments' })).not.toBeInTheDocument()
    const members = api.calls.find((call) => call.path === '/organizations/7/members')
    expect(members?.query.get('department_id')).toBe('3')
    expect(screen.queryByLabelText('Filter by department')).not.toBeInTheDocument()
  })

  it('reaches their department from the old Members address', async () => {
    mockApi(routes(makeOrg(), [sales]))
    const { router } = renderApp('/org/7/members')

    await waitFor(() => expect(router.state.location.pathname).toBe('/org/7/departments/3'))
  })

  it('is told when they aren’t in a department yet', async () => {
    mockApi(routes(makeOrg({ department_ids: [] }), []))
    renderApp('/org/7/departments')

    expect(await screen.findByText('You’re not in a department yet')).toBeInTheDocument()
  })

  it('can switch between two departments', async () => {
    mockApi(routes(makeOrg({ department_ids: [3, 4] }), [sales, engineering]))
    const { user, router } = renderApp('/org/7/departments')

    const picker = await screen.findByRole('navigation', { name: 'Your departments' })
    await user.click(within(picker).getByRole('link', { name: 'Engineering' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/org/7/departments/4'))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Engineering' }),
    ).toBeInTheDocument()
    const nav = await mainNav()
    expect(within(nav).getByRole('link', { name: 'Departments' })).toBeInTheDocument()
  })
})

describe('department roles', () => {
  it('gives a Team Lead the report', async () => {
    mockApi(
      routes(
        makeOrg({
          role_keys: ['team_lead'],
          department_permissions: { 3: ['report.view_department'] },
        }),
        [sales],
      ),
    )
    renderApp('/org/7/departments/3')

    expect(await screen.findByRole('link', { name: 'Report' })).toHaveAttribute(
      'href',
      '/org/7/reports/departments/3',
    )
    expect(screen.queryByRole('button', { name: 'Edit Sales' })).not.toBeInTheDocument()
  })

  it('keeps edit and archive for a Department Manager', async () => {
    const api = mockApi(
      routes(
        makeOrg({
          role_keys: ['department_manager'],
          department_permissions: { 3: ['department.update', 'report.view_department'] },
        }),
        [sales],
        {
          'PATCH /organizations/7/departments/3': () => jsonResponse(sales),
        },
      ),
    )
    const { user } = renderApp('/org/7/departments/3')

    await user.click(await screen.findByRole('button', { name: 'Edit Sales' }))
    await user.click(await screen.findByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(api.calls.some((call) => call.method === 'PATCH' && call.path.endsWith('/3'))).toBe(
        true,
      ),
    )
    expect(screen.getByRole('button', { name: 'Archive Sales' })).toBeInTheDocument()
  })
})

describe('Owners and Admins', () => {
  it('see every department, with All members beside it', async () => {
    mockApi(routes(admin, [sales, engineering]))
    const { user, router } = renderApp('/org/7/departments')

    const tabs = await screen.findByRole('navigation', { name: 'Departments and members' })
    const main = screen.getByRole('main')
    expect(await within(main).findByRole('link', { name: 'Engineering' })).toHaveAttribute(
      'href',
      '/org/7/departments/4',
    )
    await user.click(within(tabs).getByRole('link', { name: 'All members' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/org/7/departments/members'))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'All members' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Filter by department')).toBeInTheDocument()
    expect(screen.getByLabelText('Filter by status')).toBeInTheDocument()
  })

  it('have no separate Members item, and the old address still works', async () => {
    mockApi(routes(admin, [sales]))
    const { router } = renderApp('/org/7/members')

    await waitFor(() => expect(router.state.location.pathname).toBe('/org/7/departments/members'))
    const nav = await mainNav()
    const departments = await within(nav).findByRole('link', { name: 'Departments' })
    await waitFor(() => expect(departments).toHaveAttribute('aria-current', 'page'))
    expect(within(nav).queryByRole('link', { name: /members/i })).not.toBeInTheDocument()
  })

  it('come back to the list from a department', async () => {
    mockApi(routes(admin, [sales]))
    renderApp('/org/7/departments/3')

    expect(await screen.findByRole('link', { name: 'Departments' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Your departments' })).not.toBeInTheDocument()
  })
})

describe('the department address', () => {
  it('sends old board links to the board', async () => {
    mockApi(
      routes(makeOrg(), [sales], {
        'GET /organizations/7/departments/3/board': {
          department: { id: 3, name: 'Sales' },
          archived: false,
          review_required: false,
          can_create: false,
          columns: [],
        },
        'GET /organizations/7/tasks': emptyPage(),
      }),
    )
    const { router } = renderApp('/org/7/departments/3?layout=list')

    await waitFor(() => expect(router.state.location.pathname).toBe('/org/7/boards/3'))
    expect(router.state.location.search).toBe('?layout=list')
  })

  it('shows a department the viewer can’t open as a page that doesn’t exist', async () => {
    mockApi(
      routes(makeOrg(), [sales], {
        'GET /organizations/7/departments/4/summary': () =>
          jsonResponse(
            { error: { code: 'not_found', message: 'Department not found.', details: [] } },
            404,
          ),
      }),
    )
    renderApp('/org/7/departments/4')

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })

  it('says when a department is archived and has no manager', async () => {
    mockApi(
      routes(makeOrg(), [sales], {
        'GET /organizations/7/departments/3/summary': summary({
          department: { ...sales, status: 'archived' },
          managers: [],
        }),
      }),
    )
    renderApp('/org/7/departments/3')

    expect(await screen.findByText('This department is archived.')).toBeInTheDocument()
    expect(screen.getByText('No manager yet')).toBeInTheDocument()
  })
})
