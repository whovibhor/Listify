import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Department, MembershipRequest, MyOrganization } from '@/features/organizations/types'
import { jsonResponse, renderApp } from '@/test/render'
import { emptyPage, mockApi, noContent, signedInRoutes, testUser } from '@/test/mock-api'

afterEach(() => vi.unstubAllGlobals())

const ALL = [
  'member.view',
  'member.approve',
  'member.manage',
  'department.create',
  'department.update',
  'role.assign',
  'organization.settings.update',
]

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
    permissions: ALL,
    department_permissions: {},
    department_ids: [],
    ...overrides,
  }
}

const member = makeOrg({ role_keys: ['member'], permissions: ['member.view'] })

const sales: Department = {
  id: 3,
  organization_id: 7,
  name: 'Sales',
  description: null,
  status: 'active',
  open_for_join_requests: true,
  member_count: 2,
}

const pendingRequest: MembershipRequest = {
  id: 11,
  organization_id: 7,
  organization_name: 'Acme',
  user_id: 2,
  user_name: 'Amy Applicant',
  user_email: 'amy@example.com',
  requested_department_id: 3,
  requested_department_name: 'Sales',
  job_title: 'Rep',
  note: 'Hello!',
  status: 'pending',
  review_note: null,
  reviewed_at: null,
  created_at: '2026-10-30T09:00:00Z',
}

const orgRoutes = {
  'GET /organizations/7/departments': [sales],
  'GET /organizations/7/members': emptyPage(),
  'GET /organizations/7/membership-requests': emptyPage(),
}

describe('header workspace button', () => {
  it('swaps straight between Personal and a single organization', async () => {
    mockApi(signedInRoutes({ 'GET /me/organizations': [makeOrg()], ...orgRoutes }))
    const { user, router } = renderApp('/')

    await user.click(await screen.findByRole('link', { name: 'Switch to Acme' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/org/7'))
    expect(await screen.findByRole('heading', { name: 'Acme', level: 1 })).toBeInTheDocument()

    await user.click(await screen.findByRole('link', { name: 'Switch to Personal' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(await screen.findByRole('link', { name: 'Switch to Acme' })).toBeInTheDocument()
  })

  it('lists workspaces for two or more organizations, without Create or Join', async () => {
    const beta = makeOrg({ id: 8, name: 'Beta', slug: 'beta' })
    mockApi(signedInRoutes({ 'GET /me/organizations': [makeOrg(), beta], ...orgRoutes }))
    const { user, router } = renderApp('/')

    await user.click(await screen.findByRole('button', { name: /switch workspace/i }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: /personal/i })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /beta/i })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: /create|join/i })).not.toBeInTheDocument()
    await user.click(within(menu).getByRole('menuitem', { name: /acme/i }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/org/7'))
  })

  it('offers Create and Join only to people with no organization', async () => {
    mockApi(signedInRoutes())
    const { user, router } = renderApp('/')

    await user.click(await screen.findByRole('button', { name: 'Join or create organization' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: /create/i })).toBeInTheDocument()
    await user.click(within(menu).getByRole('menuitem', { name: /join/i }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/organizations/join'))
  })

  it('hides Create and Join from the main app once someone has joined', async () => {
    mockApi(signedInRoutes({ 'GET /me/organizations': [makeOrg()], ...orgRoutes }))
    renderApp('/org/7')

    await screen.findByRole('link', { name: 'Switch to Personal' })
    expect(screen.queryByText(/join or create|create an organization/i)).not.toBeInTheDocument()
  })
})

describe('Organizations settings', () => {
  it('lists your organizations and keeps Create and Join here', async () => {
    mockApi(signedInRoutes({ 'GET /me/organizations': [makeOrg()], ...orgRoutes }))
    renderApp('/settings/organizations')

    const main = await screen.findByRole('main')
    expect(await within(main).findByRole('link', { name: /acme/i })).toHaveAttribute(
      'href',
      '/org/7',
    )
    expect(within(main).getByRole('link', { name: /create an organization/i })).toHaveAttribute(
      'href',
      '/organizations/new',
    )
    expect(within(main).getByRole('link', { name: /join an organization/i })).toHaveAttribute(
      'href',
      '/organizations/join',
    )
  })
})

describe('remembering the workspace', () => {
  const inAcme = { ...testUser, last_organization_id: 7 }

  it('keeps the organization around pages outside any workspace', async () => {
    mockApi(
      signedInRoutes({ 'GET /me': inAcme, 'GET /me/organizations': [makeOrg()], ...orgRoutes }),
    )
    renderApp('/settings/profile')

    const nav = (await screen.findAllByRole('navigation', { name: 'Main' }))[0]
    expect(await within(nav).findByRole('link', { name: /team tasks/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Switch to Personal' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Listify home' })[0]).toHaveAttribute(
      'href',
      '/org/7',
    )
  })

  it('saves the organization you open', async () => {
    const { calls } = mockApi(
      signedInRoutes({ 'GET /me/organizations': [makeOrg()], ...orgRoutes }),
    )
    renderApp('/org/7')

    await waitFor(() =>
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
        last_organization_id: 7,
      }),
    )
  })

  it('reopens the last organization on a fresh visit', async () => {
    mockApi(
      signedInRoutes({ 'GET /me': inAcme, 'GET /me/organizations': [makeOrg()], ...orgRoutes }),
    )
    const { router } = renderApp('/')

    await waitFor(() => expect(router.state.location.pathname).toBe('/org/7'))
  })

  it('stays on Personal when you choose it, and saves that', async () => {
    const { calls } = mockApi(
      signedInRoutes({ 'GET /me': inAcme, 'GET /me/organizations': [makeOrg()], ...orgRoutes }),
    )
    const { user, router } = renderApp('/org/7')

    await user.click(await screen.findByRole('link', { name: 'Switch to Personal' }))

    await waitFor(() =>
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
        last_organization_id: null,
      }),
    )
    expect(router.state.location.pathname).toBe('/')
    expect(await screen.findByRole('heading', { name: 'Hi, Ada' })).toBeInTheDocument()
  })

  it('stays on Personal when the last organization is no longer yours', async () => {
    mockApi(signedInRoutes({ 'GET /me': inAcme }))
    const { router } = renderApp('/')

    expect(await screen.findByRole('heading', { name: 'Hi, Ada' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })
})

describe('sidebar', () => {
  it('puts Overview, Inbox and Boards above the work items', async () => {
    mockApi(signedInRoutes({ 'GET /me/organizations': [makeOrg()], ...orgRoutes }))
    renderApp('/org/7')

    const nav = (await screen.findAllByRole('navigation', { name: 'Main' }))[0]
    await within(nav).findByRole('heading', { name: 'Boards' })
    const links = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent)
    expect(links.slice(0, 2)).toEqual(['Overview', 'Inbox'])
    expect(links.indexOf('Sales')).toBeLessThan(links.indexOf('My Work'))
  })

  it('collapses to an icon rail, saves the choice and keeps boards in one menu', async () => {
    const { calls } = mockApi(
      signedInRoutes({ 'GET /me/organizations': [makeOrg()], ...orgRoutes }),
    )
    const { user, router } = renderApp('/org/7')
    const nav = (await screen.findAllByRole('navigation', { name: 'Main' }))[0]
    await within(nav).findByRole('heading', { name: 'Boards' })

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    expect(await screen.findByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.path === '/me/preferences' &&
            (call.body as { sidebar_collapsed?: boolean }).sidebar_collapsed === true,
        ),
      ).toBe(true),
    )
    const rail = screen.getAllByRole('navigation', { name: 'Main' })[0]
    expect(within(rail).getByRole('link', { name: 'Team Tasks' })).toHaveClass('size-9')

    await user.click(within(rail).getByRole('button', { name: 'Boards' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Sales' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/org/7/departments/3'))
  })

  it('opens collapsed when that was saved, and shows waiting items as a dot', async () => {
    mockApi(
      signedInRoutes({
        'GET /me': { ...testUser, sidebar_collapsed: true },
        'GET /inbox/summary': { unread: 3, pending_update_requests: 0 },
      }),
    )
    renderApp('/')

    expect(await screen.findByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Inbox, 3 pending' })).toBeInTheDocument()
  })
})

describe('navigation follows permissions', () => {
  it('shows administration to owners', async () => {
    mockApi(signedInRoutes({ 'GET /me/organizations': [makeOrg()], ...orgRoutes }))
    renderApp('/org/7')

    const nav = (await screen.findAllByRole('navigation', { name: 'Main' }))[0]
    expect(await within(nav).findByRole('link', { name: /join requests/i })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /settings/i })).toBeInTheDocument()
  })

  it('hides administration from members, and direct URLs show a permission message', async () => {
    mockApi(signedInRoutes({ 'GET /me/organizations': [member], ...orgRoutes }))
    renderApp('/org/7/requests')

    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument()
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0]
    expect(within(nav).queryByRole('link', { name: /join requests/i })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: /settings/i })).not.toBeInTheDocument()
  })

  it('treats an organization you do not belong to as not found', async () => {
    mockApi(signedInRoutes())
    renderApp('/org/999')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })
})

describe('creating an organization', () => {
  it('validates, sends departments and opens the new workspace', async () => {
    const organizations: MyOrganization[] = []
    const { calls } = mockApi(
      signedInRoutes({
        'GET /me/organizations': () => jsonResponse(organizations),
        'POST /organizations': () => {
          organizations.push(makeOrg())
          return jsonResponse(makeOrg(), 201)
        },
        ...orgRoutes,
      }),
    )
    const { user, router } = renderApp('/organizations/new')

    await user.click(await screen.findByRole('button', { name: 'Create organization' }))
    expect(await screen.findByText('Use at least 2 characters.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Organization name'), 'Acme')
    await user.type(screen.getByLabelText('Department name'), 'Sales{Enter}')
    await user.click(screen.getByRole('button', { name: 'Engineering' }))
    await user.click(screen.getByRole('switch'))
    await user.click(screen.getByRole('button', { name: 'Create organization' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/org/7'))
    expect(
      calls.find((c) => c.method === 'POST' && c.path === '/organizations')?.body,
    ).toMatchObject({
      name: 'Acme',
      is_discoverable: true,
      timezone: 'Asia/Kolkata',
      departments: [{ name: 'Sales' }, { name: 'Engineering' }],
    })
  })
})

describe('joining an organization', () => {
  it('searches, chooses a department and sends a request', async () => {
    const { calls } = mockApi(
      signedInRoutes({
        'GET /me/membership-requests': [],
        'GET /organizations/discover': emptyPage([
          {
            id: 7,
            name: 'Acme',
            description: 'We build things',
            location: 'Pune',
            website: null,
            my_status: 'none',
          },
        ]),
        'GET /organizations/7/join-info': {
          id: 7,
          name: 'Acme',
          description: null,
          location: null,
          website: null,
          my_status: 'none',
          departments: [sales],
        },
        'POST /organizations/7/membership-requests': () =>
          jsonResponse(
            {
              id: 1,
              organization_id: 7,
              organization_name: 'Acme',
              requested_department_name: 'Sales',
              status: 'pending',
              review_note: null,
              created_at: '2026-10-30T09:00:00Z',
            },
            201,
          ),
      }),
    )
    const { user } = renderApp('/organizations/join')

    await user.type(await screen.findByLabelText('Search organizations by name'), 'acme')
    await user.click(await screen.findByRole('button', { name: 'Request to join Acme' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByLabelText('Department')

    await user.click(within(dialog).getByRole('button', { name: 'Send request' }))
    expect(await within(dialog).findByText('Choose a department.')).toBeInTheDocument()

    await user.selectOptions(within(dialog).getByLabelText('Department'), 'Sales')
    await user.click(within(dialog).getByRole('button', { name: 'Send request' }))

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ department_id: 3 }),
    )
  })
})

describe('reviewing requests', () => {
  it('approves with an amended role', async () => {
    const { calls } = mockApi(
      signedInRoutes({
        'GET /me/organizations': [makeOrg()],
        ...orgRoutes,
        'GET /organizations/7/membership-requests': emptyPage([pendingRequest]),
        'POST /organizations/7/membership-requests/11/approve': {
          ...pendingRequest,
          status: 'approved',
        },
      }),
    )
    const { user } = renderApp('/org/7/requests')

    await user.click(await screen.findByRole('button', { name: 'Approve Amy Applicant' }))
    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('Role'), 'team_lead')
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }))

    await waitFor(() =>
      expect(calls.find((c) => c.path.endsWith('/approve'))?.body).toEqual({
        department_id: 3,
        role_key: 'team_lead',
      }),
    )
  })

  it('declines with a reason', async () => {
    const { calls } = mockApi(
      signedInRoutes({
        'GET /me/organizations': [makeOrg()],
        ...orgRoutes,
        'GET /organizations/7/membership-requests': emptyPage([pendingRequest]),
        'POST /organizations/7/membership-requests/11/reject': {
          ...pendingRequest,
          status: 'rejected',
        },
      }),
    )
    const { user } = renderApp('/org/7/requests')

    await user.click(await screen.findByRole('button', { name: 'Decline Amy Applicant' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox'), 'Hiring is paused')
    await user.click(within(dialog).getByRole('button', { name: 'Decline request' }))

    await waitFor(() =>
      expect(calls.find((c) => c.path.endsWith('/reject'))?.body).toEqual({
        note: 'Hiring is paused',
      }),
    )
  })
})

describe('invitations', () => {
  it('shows the one-time link after creating a shareable invitation', async () => {
    mockApi(
      signedInRoutes({
        'GET /me/organizations': [makeOrg()],
        ...orgRoutes,
        'GET /organizations/7/invitations': [],
        'POST /organizations/7/invitations': () =>
          jsonResponse(
            {
              id: 1,
              email: null,
              role_name: 'Member',
              department_name: null,
              expires_at: '2026-11-06T09:00:00Z',
              status: 'pending',
              created_at: '2026-10-30T09:00:00Z',
              link: 'http://localhost:5173/invite/secret',
            },
            201,
          ),
      }),
    )
    const { user } = renderApp('/org/7/invitations')

    await user.click(await screen.findByRole('button', { name: 'Create link' }))

    expect(await screen.findByLabelText('Invitation link')).toHaveValue(
      'http://localhost:5173/invite/secret',
    )
  })

  it('accepts an invitation from its link', async () => {
    mockApi(
      signedInRoutes({
        'GET /me/organizations': [makeOrg()],
        ...orgRoutes,
        'GET /invitations/abc': {
          organization_id: 7,
          organization_name: 'Acme',
          organization_description: null,
          department_name: 'Sales',
          role_name: 'Member',
          email: null,
          already_member: false,
        },
        'POST /invitations/abc/accept': { organization_id: 7 },
        'GET /auth/csrf': noContent,
      }),
    )
    const { user, router } = renderApp('/invite/abc')

    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/org/7'))
  })

  it('explains why an invitation cannot be used', async () => {
    mockApi(
      signedInRoutes({
        'GET /invitations/used': () =>
          jsonResponse(
            {
              error: {
                code: 'invitation_invalid',
                message: 'This invitation is invalid, has expired or was already used.',
                details: [],
                request_id: null,
              },
            },
            400,
          ),
      }),
    )
    renderApp('/invite/used')

    expect(await screen.findByText("This invitation can't be used")).toBeInTheDocument()
  })
})

describe('admin invitations', () => {
  it('asks for an email address only when inviting an Admin', async () => {
    mockApi(
      signedInRoutes({
        'GET /me/organizations': [makeOrg()],
        ...orgRoutes,
        'GET /organizations/7/invitations': [],
      }),
    )
    const { user } = renderApp('/org/7/invitations')

    const optional = await screen.findByLabelText('Email (optional)')
    expect(optional).not.toBeRequired()

    await user.selectOptions(screen.getByLabelText('Role'), 'admin')

    expect(screen.getByLabelText('Email')).toBeRequired()
  })
})
