import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { emptyPage, mockApi, signedInRoutes } from '@/test/mock-api'
import { renderApp } from '@/test/render'

beforeEach(() => {
  mockApi(signedInRoutes())
})

describe('AppShell', () => {
  it('renders brand, main navigation and greets the signed-in user', async () => {
    renderApp('/')

    expect(await screen.findByRole('heading', { name: 'Hi, Ada' })).toBeInTheDocument()
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0]
    expect(within(nav).getByRole('link', { name: /my day/i })).toHaveAttribute(
      'href',
      '/personal/my-day',
    )
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toBeInTheDocument()
  })

  it('marks the current route as active', async () => {
    renderApp('/personal/tasks')

    const nav = (await screen.findAllByRole('navigation', { name: 'Main' }))[0]
    expect(within(nav).getByRole('link', { name: /my tasks/i })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('opens the inbox from the notifications bell', async () => {
    mockApi(signedInRoutes({ 'GET /inbox': emptyPage(), 'GET /me/update-requests': [] }))
    const { user } = renderApp('/')

    await user.click(await screen.findByRole('link', { name: 'Notifications' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Inbox' })).toBeInTheDocument()
  })

  it('opens the mobile navigation sheet and closes it after navigating', async () => {
    const { user } = renderApp('/')

    await user.click(await screen.findByRole('button', { name: 'Open navigation' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('link', { name: /completed/i }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // The Completed page is lazy-loaded.
    expect(await screen.findByRole('heading', { name: 'Completed', level: 1 })).toBeInTheDocument()
  })

  it('renders a not-found page for unknown routes', async () => {
    renderApp('/nope')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })
})
