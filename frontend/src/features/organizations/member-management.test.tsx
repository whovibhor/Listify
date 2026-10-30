import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  Department,
  Member,
  MemberImpact,
  MyOrganization,
} from '@/features/organizations/types'
import { jsonResponse, renderApp } from '@/test/render'
import { emptyPage, mockApi, noContent, signedInRoutes } from '@/test/mock-api'

afterEach(() => vi.unstubAllGlobals())

const org: MyOrganization = {
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
  permissions: ['member.view', 'member.manage', 'role.assign'],
  department_permissions: {},
  department_ids: [],
}

const department = (id: number, name: string): Department => ({
  id,
  organization_id: 7,
  name,
  description: null,
  status: 'active',
  open_for_join_requests: true,
  member_count: 1,
})

const mia: Member = {
  membership_id: 21,
  user_id: 2,
  name: 'Mia Member',
  email: 'mia@example.com',
  job_title: 'Rep',
  status: 'active',
  joined_at: '2026-10-30T09:00:00Z',
  roles: [
    { key: 'member', name: 'Member', department_id: null },
    { key: 'team_lead', name: 'Team Lead', department_id: 3 },
  ],
  departments: [{ id: 3, name: 'Sales' }],
  actions: [
    'change_roles',
    'suspend',
    'remove',
    'transfer',
    'add_department',
    'leave_department',
    'make_owner',
  ],
}

const impact: MemberImpact = {
  action: 'suspend',
  member_name: 'Mia Member',
  departments_losing: [{ id: 3, name: 'Sales' }],
  departments_gaining: [],
  departments_keeping: [],
  roles_ending: mia.roles,
  keeps_every_department: false,
  sole_manager_of: [{ id: 3, name: 'Sales' }],
  pending_requests: 2,
  tasks_to_reassign: 3,
}

const routes = {
  'GET /me/organizations': [org],
  'GET /organizations/7/departments': [department(3, 'Sales'), department(4, 'Engineering')],
  'GET /organizations/7/members': emptyPage([mia]),
  'GET /organizations/7/members/21/impact': impact,
}

async function openSheet(extra: Record<string, unknown> = {}) {
  const api = mockApi(signedInRoutes({ ...routes, ...extra }))
  const view = renderApp('/org/7/members')
  await view.user.click(await screen.findByRole('button', { name: 'Manage Mia Member' }))
  const sheet = await screen.findByRole('dialog', { name: 'Mia Member' })
  return { ...view, api, sheet }
}

function lastCall(api: ReturnType<typeof mockApi>, method: string, path: string) {
  return api.calls.filter((call) => call.method === method && call.path === path).at(-1)
}

describe('members list', () => {
  it('shows department roles with their department', async () => {
    mockApi(signedInRoutes(routes))
    renderApp('/org/7/members')
    expect(await screen.findByText('Team Lead · Sales')).toBeInTheDocument()
  })

  it('offers Manage only for members the viewer may change', async () => {
    mockApi(
      signedInRoutes({
        ...routes,
        'GET /me/organizations': [{ ...org, permissions: ['member.view'] }],
        'GET /organizations/7/members': emptyPage([{ ...mia, actions: [] }]),
      }),
    )
    renderApp('/org/7/members')
    expect(await screen.findByText('Mia Member')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Manage/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Filter by status')).not.toBeInTheDocument()
  })

  it('filters by status', async () => {
    const api = mockApi(signedInRoutes(routes))
    const { user } = renderApp('/org/7/members')
    await user.selectOptions(await screen.findByLabelText('Filter by status'), 'suspended')
    await waitFor(() =>
      expect(
        api.calls.some(
          (call) =>
            call.path === '/organizations/7/members' && call.query.get('status') === 'suspended',
        ),
      ).toBe(true),
    )
  })
})

describe('member sheet', () => {
  it('shows only the actions the server allows', async () => {
    const { sheet } = await openSheet({
      'GET /organizations/7/members': emptyPage([
        { ...mia, status: 'suspended', actions: ['reactivate', 'remove'] },
      ]),
    })
    expect(within(sheet).getByRole('button', { name: 'Reactivate' })).toBeInTheDocument()
    expect(
      within(sheet).getByRole('button', { name: 'Remove from organization' }),
    ).toBeInTheDocument()
    for (const name of ['Suspend', 'Change roles', 'Make Owner', /^Move/, /^Take/]) {
      expect(within(sheet).queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })

  it('changes roles, keeping one choice per department', async () => {
    const { user, sheet, api } = await openSheet({
      'PATCH /organizations/7/members/21/roles': mia,
    })
    await user.click(within(sheet).getByRole('button', { name: 'Change roles' }))
    const dialog = await screen.findByRole('dialog', { name: 'Change Mia Member’s roles' })
    expect(within(dialog).getByLabelText('Role in Sales')).toHaveValue('team_lead')

    await user.selectOptions(within(dialog).getByLabelText('Organization role'), 'admin')
    await user.selectOptions(within(dialog).getByLabelText('Role in Sales'), 'department_manager')
    await user.click(within(dialog).getByRole('button', { name: 'Save roles' }))

    await waitFor(() =>
      expect(lastCall(api, 'PATCH', '/organizations/7/members/21/roles')?.body).toEqual({
        organization_role: 'admin',
        department_roles: [{ department_id: 3, role_key: 'department_manager' }],
      }),
    )
  })

  it('shows the impact before suspending, and sends the reason', async () => {
    const { user, sheet, api } = await openSheet({
      'POST /organizations/7/members/21/suspend': { ...mia, status: 'suspended' },
    })
    await user.click(within(sheet).getByRole('button', { name: 'Suspend' }))
    const dialog = await screen.findByRole('dialog', { name: 'Suspend Mia Member?' })

    expect(await within(dialog).findByText('Access paused')).toBeInTheDocument()
    expect(within(dialog).getByText('Team Lead · Sales', { exact: false })).toBeInTheDocument()
    expect(within(dialog).getByText('Not affected')).toBeInTheDocument()
    expect(within(dialog).getByText('3 flagged for reassignment')).toBeInTheDocument()
    expect(
      within(dialog).getByText(/Sales will have no Department Manager\. 2 join requests/),
    ).toBeInTheDocument()

    await user.type(within(dialog).getByRole('textbox'), 'On leave')
    await user.click(within(dialog).getByRole('button', { name: 'Suspend member' }))

    await waitFor(() =>
      expect(lastCall(api, 'POST', '/organizations/7/members/21/suspend')?.body).toEqual({
        reason: 'On leave',
      }),
    )
  })

  it('cannot confirm when the preview is refused', async () => {
    const { user, sheet } = await openSheet({
      'GET /organizations/7/members/21/impact': () =>
        jsonResponse(
          {
            error: {
              code: 'owner_protected',
              message: 'Only the Owner can do that.',
              details: [],
              request_id: null,
            },
          },
          403,
        ),
    })
    await user.click(within(sheet).getByRole('button', { name: 'Remove from organization' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove Mia Member?' })

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Only the Owner can do that.',
    )
    expect(within(dialog).getByRole('button', { name: 'Remove member' })).toBeDisabled()
  })

  it('moves a member only after a destination is chosen and previewed', async () => {
    const { user, sheet, api } = await openSheet({
      'POST /organizations/7/members/21/transfer': mia,
      'GET /organizations/7/members/21/impact': {
        ...impact,
        action: 'transfer',
        departments_gaining: [{ id: 4, name: 'Engineering' }],
      },
    })
    await user.click(within(sheet).getByRole('button', { name: 'Move Mia Member out of Sales' }))
    const dialog = await screen.findByRole('dialog', { name: 'Move Mia Member' })
    const confirm = within(dialog).getByRole('button', { name: 'Move member' })
    expect(confirm).toBeDisabled()

    await user.selectOptions(
      within(dialog).getByLabelText('Move from Sales to'),
      within(dialog).getByRole('option', { name: 'Engineering' }),
    )
    expect(await within(dialog).findByText('Joins')).toBeInTheDocument()
    await waitFor(() => expect(confirm).toBeEnabled())
    await user.click(confirm)

    await waitFor(() =>
      expect(lastCall(api, 'POST', '/organizations/7/members/21/transfer')?.body).toEqual({
        from_department_id: 3,
        to_department_id: 4,
      }),
    )
  })

  it('takes a member out of a department', async () => {
    const { user, sheet, api } = await openSheet({
      'DELETE /organizations/7/members/21/departments/3': mia,
    })
    await user.click(within(sheet).getByRole('button', { name: 'Take Mia Member out of Sales' }))
    const dialog = await screen.findByRole('dialog', { name: 'Take Mia Member out of Sales?' })
    const confirm = within(dialog).getByRole('button', { name: 'Take out of department' })
    await waitFor(() => expect(confirm).toBeEnabled())
    await user.click(confirm)
    await waitFor(() =>
      expect(lastCall(api, 'DELETE', '/organizations/7/members/21/departments/3')).toBeDefined(),
    )
  })

  it('adds a member to another department', async () => {
    const { user, sheet, api } = await openSheet({
      'POST /organizations/7/members/21/departments': mia,
    })
    await user.selectOptions(
      within(sheet).getByRole('combobox', { name: 'Add to a department' }),
      await within(sheet).findByRole('option', { name: 'Engineering' }),
    )
    await user.click(within(sheet).getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(lastCall(api, 'POST', '/organizations/7/members/21/departments')?.body).toEqual({
        department_id: 4,
      }),
    )
  })

  it('needs the password to transfer ownership, and shows when it is wrong', async () => {
    const { user, sheet, api } = await openSheet({
      'POST /organizations/7/ownership-transfer': (init: RequestInit) =>
        JSON.parse(String(init.body)).password === 'right'
          ? noContent()
          : jsonResponse(
              {
                error: {
                  code: 'validation_error',
                  message: 'Validation failed',
                  details: [{ field: 'password', message: "That password isn't correct." }],
                  request_id: null,
                },
              },
              422,
            ),
    })
    await user.click(within(sheet).getByRole('button', { name: 'Make Owner' }))
    const dialog = await screen.findByRole('dialog', { name: 'Make Mia Member the Owner?' })
    const password = within(dialog).getByLabelText('Your password')

    await user.type(password, 'wrong')
    await user.click(within(dialog).getByRole('button', { name: 'Transfer ownership' }))
    expect(await within(dialog).findByText("That password isn't correct.")).toBeInTheDocument()

    await user.clear(password)
    await user.type(password, 'right')
    await user.click(within(dialog).getByRole('button', { name: 'Transfer ownership' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /the Owner\?/ })).not.toBeInTheDocument(),
    )
    expect(lastCall(api, 'POST', '/organizations/7/ownership-transfer')?.body).toEqual({
      membership_id: 21,
      password: 'right',
    })
  })
})

describe('losing access while a page is open', () => {
  it('reloads access after a 404, so the organization disappears', async () => {
    let suspended = false
    const refused = () =>
      jsonResponse(
        {
          error: {
            code: 'not_found',
            message: 'Organization not found.',
            details: [],
            request_id: null,
          },
        },
        404,
      )
    mockApi(
      signedInRoutes({
        ...routes,
        'GET /me/organizations': () => jsonResponse(suspended ? [] : [org]),
        'GET /organizations/7/members': () =>
          suspended ? refused() : jsonResponse(emptyPage([mia])),
      }),
    )
    const { user } = renderApp('/org/7/members')
    await screen.findByText('Mia Member')

    suspended = true
    await user.type(screen.getByLabelText('Search members by name or email'), 'x')

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })
})
