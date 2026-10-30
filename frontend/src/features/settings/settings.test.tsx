import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mockApi, noContent, signedInRoutes, testUser } from '@/test/mock-api'
import { renderApp } from '@/test/render'

afterEach(() => vi.unstubAllGlobals())

const sessions = [
  {
    id: 1,
    created_at: '2026-10-29T08:00:00Z',
    last_seen_at: new Date().toISOString(),
    ip_address: '127.0.0.1',
    user_agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36',
    current: true,
  },
  {
    id: 2,
    created_at: '2026-10-28T08:00:00Z',
    last_seen_at: '2026-10-28T09:00:00Z',
    ip_address: '10.0.0.5',
    user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1',
    current: false,
  },
]

describe('profile settings', () => {
  it('saves name and timezone and keeps the button disabled until something changes', async () => {
    const { calls } = mockApi(
      signedInRoutes({
        'PATCH /me': { ...testUser, name: 'Ada King', timezone: 'Europe/London' },
      }),
    )
    const { user } = renderApp('/settings/profile')

    const save = await screen.findByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled()

    const name = screen.getByLabelText('Full name')
    await user.clear(name)
    await user.type(name, 'Ada King')
    await user.selectOptions(screen.getByLabelText('Timezone'), 'Europe/London')
    await user.click(save)

    expect(await screen.findByText('Profile saved')).toBeInTheDocument()
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      name: 'Ada King',
      timezone: 'Europe/London',
    })
  })
})

describe('security settings', () => {
  it('lists sessions and signs out another device after confirmation', async () => {
    let current = sessions
    const { calls } = mockApi(
      signedInRoutes({
        'GET /me/sessions': () => new Response(JSON.stringify(current), { status: 200 }),
        'DELETE /me/sessions/2': () => {
          current = sessions.slice(0, 1)
          return noContent()
        },
      }),
    )
    const { user } = renderApp('/settings/security')

    expect(await screen.findByText('Chrome on Windows')).toBeInTheDocument()
    expect(screen.getByText('This device')).toBeInTheDocument()
    const iphoneRow = screen.getByText('Safari on iOS').closest('li')!
    await user.click(within(iphoneRow).getByRole('button', { name: 'Sign out' }))
    await user.click(await screen.findByRole('button', { name: 'Sign out device' }))

    await waitFor(() => expect(screen.queryByText('Safari on iOS')).not.toBeInTheDocument())
    expect(calls.some((call) => call.method === 'DELETE' && call.path === '/me/sessions/2')).toBe(
      true,
    )
  })

  it('shows a wrong current password on the field', async () => {
    mockApi(
      signedInRoutes({
        'GET /me/sessions': sessions,
        'POST /me/password': () =>
          new Response(
            JSON.stringify({
              error: {
                code: 'validation_error',
                message: 'Choose a stronger password.',
                details: [{ field: 'current_password', message: 'Current password is incorrect.' }],
                request_id: null,
              },
            }),
            { status: 422 },
          ),
      }),
    )
    const { user } = renderApp('/settings/security')

    await user.type(await screen.findByLabelText('Current password'), 'not my password')
    await user.type(screen.getByLabelText('New password'), 'a brand new passphrase')
    await user.type(screen.getByLabelText('Confirm new password'), 'a brand new passphrase')
    await user.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument()
  })
})
