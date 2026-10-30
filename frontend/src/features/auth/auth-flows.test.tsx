import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { jsonResponse, renderApp } from '@/test/render'
import {
  healthyResponse,
  mockApi,
  noContent,
  signedInRoutes,
  testUser,
  unauthenticated,
} from '@/test/mock-api'

afterEach(() => vi.unstubAllGlobals())

const guestRoutes = {
  'GET /me': unauthenticated,
  'GET /auth/csrf': noContent,
  'GET /health': healthyResponse,
}

describe('route protection', () => {
  it('sends signed-out visitors to sign in and remembers where they were going', async () => {
    mockApi(guestRoutes)
    const { router } = renderApp('/settings/security')

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toBe('?next=%2Fsettings%2Fsecurity')
  })

  it('keeps signed-in users out of the sign-in page', async () => {
    mockApi(signedInRoutes())
    const { router } = renderApp('/login')

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })
})

describe('sign in', () => {
  it('validates fields before calling the API', async () => {
    const { calls } = mockApi(guestRoutes)
    const { user } = renderApp('/login')

    await user.click(await screen.findByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Enter your email.')).toBeInTheDocument()
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    expect(calls.some((call) => call.path === '/auth/login')).toBe(false)
  })

  it('shows the generic error for bad credentials and clears the password', async () => {
    mockApi({
      ...guestRoutes,
      'POST /auth/login': () =>
        jsonResponse(
          {
            error: {
              code: 'invalid_credentials',
              message: 'Email or password is incorrect.',
              details: [],
              request_id: 'r1',
            },
          },
          401,
        ),
    })
    const { user } = renderApp('/login')

    await user.type(await screen.findByLabelText('Email'), 'ada@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrong password!!')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Email or password is incorrect.')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })

  it('signs in, fetches a CSRF token first, and returns to the requested page', async () => {
    const { calls } = mockApi({ ...guestRoutes, 'POST /auth/login': testUser })
    const { user, router } = renderApp('/login?next=%2Fsettings%2Fprofile')

    await user.type(await screen.findByLabelText('Email'), 'ada@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/profile'))
    const csrfIndex = calls.findIndex((call) => call.path === '/auth/csrf')
    const loginIndex = calls.findIndex((call) => call.path === '/auth/login')
    expect(csrfIndex).toBeGreaterThanOrEqual(0)
    expect(csrfIndex).toBeLessThan(loginIndex)
    expect(calls[loginIndex].body).toEqual({
      email: 'ada@example.com',
      password: 'correct horse battery staple',
    })
  })

  it('ignores off-site redirect targets', async () => {
    mockApi({ ...guestRoutes, 'POST /auth/login': testUser })
    const { user, router } = renderApp('/login?next=%2F%2Fevil.example')

    await user.type(await screen.findByLabelText('Email'), 'ada@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })
})

describe('registration', () => {
  it('requires terms and shows server password feedback on the field', async () => {
    mockApi({
      ...guestRoutes,
      'POST /auth/register': () =>
        jsonResponse(
          {
            error: {
              code: 'validation_error',
              message: 'Choose a stronger password.',
              details: [{ field: 'password', message: 'This password is too common.' }],
              request_id: null,
            },
          },
          422,
        ),
    })
    const { user } = renderApp('/register')

    await user.type(await screen.findByLabelText('Full name'), 'Ada Lovelace')
    await user.type(screen.getByLabelText('Email'), 'ada@example.com')
    await user.type(screen.getByLabelText('Password'), 'password1234')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('You need to accept the terms to continue.')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('This password is too common.')).toBeInTheDocument()
  })

  it('creates the account with the detected timezone and opens onboarding', async () => {
    const { calls } = mockApi({ ...guestRoutes, 'POST /auth/register': testUser })
    const { user, router } = renderApp('/register')

    await user.type(await screen.findByLabelText('Full name'), 'Ada Lovelace')
    await user.type(screen.getByLabelText('Email'), 'ada@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/welcome'))
    expect(await screen.findByRole('heading', { name: 'Welcome, Ada!' })).toBeInTheDocument()
    const body = calls.find((call) => call.path === '/auth/register')?.body as Record<
      string,
      unknown
    >
    expect(body).toMatchObject({ accept_terms: true, email: 'ada@example.com' })
    expect(typeof body.timezone).toBe('string')
  })
})

describe('password reset', () => {
  it('confirms the request without revealing whether the account exists', async () => {
    mockApi({ ...guestRoutes, 'POST /auth/password/forgot': { message: 'ok' } })
    const { user } = renderApp('/forgot-password')

    await user.type(await screen.findByLabelText('Email'), 'someone@example.com')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
  })

  it('removes the token from the URL and sets a new password', async () => {
    const { calls } = mockApi({ ...guestRoutes, 'POST /auth/password/reset': noContent })
    const { user, router } = renderApp('/reset-password?token=secret-token-123')

    await screen.findByRole('heading', { name: 'Choose a new password' })
    await waitFor(() => expect(router.state.location.search).toBe(''))

    await user.type(screen.getByLabelText('New password'), 'a brand new passphrase')
    await user.type(screen.getByLabelText('Confirm new password'), 'a different passphrase')
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    expect(await screen.findByText("Passwords don't match.")).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Confirm new password'))
    await user.type(screen.getByLabelText('Confirm new password'), 'a brand new passphrase')
    await user.click(screen.getByRole('button', { name: 'Update password' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(calls.find((call) => call.path === '/auth/password/reset')?.body).toEqual({
      token: 'secret-token-123',
      password: 'a brand new passphrase',
    })
  })
})

describe('signing out', () => {
  it('signs out from the account menu and returns to sign-in', async () => {
    const { calls } = mockApi(signedInRoutes({ 'POST /auth/logout': noContent }))
    const { user, router } = renderApp('/')

    await user.click(await screen.findByRole('button', { name: 'Account and preferences' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(calls.some((call) => call.method === 'POST' && call.path === '/auth/logout')).toBe(true)
  })

  it('returns to sign-in when the session expires mid-use', async () => {
    let meCalls = 0
    mockApi(
      signedInRoutes({
        'GET /me': () => (meCalls++ === 0 ? jsonResponse(testUser) : unauthenticated()),
        'GET /me/sessions': unauthenticated,
      }),
    )
    const { router } = renderApp('/settings/security')

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })
})
