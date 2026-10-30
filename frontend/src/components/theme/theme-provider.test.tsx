import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { THEME_STORAGE_KEY } from '@/components/theme/theme-context'
import { jsonResponse, renderApp } from '@/test/render'
import { mockApi, signedInRoutes, testUser } from '@/test/mock-api'

afterEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

async function chooseDark(user: ReturnType<typeof renderApp>['user']) {
  await user.click(await screen.findByRole('button', { name: 'Account and preferences' }))
  await user.click(await screen.findByRole('menuitemradio', { name: 'Dark' }))
}

describe('theme preference', () => {
  it('applies instantly and saves the choice to the account', async () => {
    const { calls } = mockApi(signedInRoutes({ 'PATCH /me/preferences': { theme: 'dark' } }))
    const { user } = renderApp('/personal/completed')

    await chooseDark(user)

    expect(document.documentElement).toHaveClass('dark')
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH' && c.path === '/me/preferences')?.body).toEqual(
        {
          theme: 'dark',
        },
      ),
    )
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it("uses the account's saved theme over this browser's cached copy", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    mockApi(signedInRoutes({ 'GET /me': { ...testUser, theme: 'dark' } }))
    renderApp('/personal/completed')

    await waitFor(() => expect(document.documentElement).toHaveClass('dark'))
  })

  it('rolls back when the account copy cannot be saved', async () => {
    mockApi(
      signedInRoutes({
        'PATCH /me/preferences': () =>
          jsonResponse(
            { error: { code: 'internal_error', message: 'x', details: [], request_id: null } },
            500,
          ),
      }),
    )
    const { user } = renderApp('/personal/completed')

    await chooseDark(user)

    expect(
      await screen.findByText("Couldn't save your theme. Please try again."),
    ).toBeInTheDocument()
    expect(document.documentElement).not.toHaveClass('dark')
  })
})
