import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Department, MembershipRequest, MyOrganization } from '@/features/organizations/types'
import { jsonResponse, renderApp } from '@/test/render'
import { emptyPage, mockApi, noContent, signedInRoutes } from '@/test/mock-api'

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

describe('workspace switcher', () => {
  it('lists Personal and active organizations and switches workspace', async () => {
    mockApi(signedInRoutes({ 'GET /me/organizations': [makeOrg()], ...orgRoutes }))
    const { user, router } = renderApp('/')

    const switcher = await screen.findAllByRole('button', { name: /switch workspace/i })
    await user.click(switcher[0])
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: /personal/i })).toBeInTheDocument()
    await user.click(within(menu).getByRole('menuitem', { name: /acme/i }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/org/7'))
    expect(await screen.findByRole('heading', { name: 'Acme', level: 1 })).toBeInTheDocument()
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
