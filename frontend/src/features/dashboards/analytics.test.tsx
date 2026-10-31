import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { emptyDashboard, mockApi, signedInRoutes } from '@/test/mock-api'
import { renderApp } from '@/test/render'

// These pages load the chart library on demand. On a slow first run that alone can outlast a
// test's wait for the page, so it's loaded before the tests start.
beforeAll(() => import('recharts'), 30_000)
afterEach(() => vi.unstubAllGlobals())

const dashboard = {
  ...emptyDashboard,
  counts: {
    due_today: 2,
    overdue: 1,
    upcoming_7d: 3,
    open: 9,
    completed_in_period: 5,
    created_in_period: 7,
  },
  on_time: { eligible: 4, on_time: 3, rate: 0.75 },
  trend: [
    { date: '2026-10-29', completed: 2, created: 1 },
    { date: '2026-10-30', completed: 3, created: 6 },
  ],
  open_by_priority: { low: 1, medium: 5, high: 2, urgent: 1 },
  open_by_status: { not_started: 6, in_progress: 2, blocked: 1 },
  definitions: { overdue: 'Open tasks whose deadline is earlier than now.' },
}

describe('Personal analytics', () => {
  it('shows headline metrics, breakdowns and a table view of the trend', async () => {
    mockApi(signedInRoutes({ 'GET /me/dashboard': dashboard }))
    const { user } = renderApp('/personal/analytics')

    expect(await screen.findByText('75%')).toBeInTheDocument()
    expect(screen.getByText('3 of 4 tasks with a deadline')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /overdue/i })).toHaveAttribute(
      'href',
      '/personal/tasks?overdue=true',
    )
    const priorities = screen.getByRole('list', { name: 'Open tasks by priority' })
    expect(within(priorities).getByText('Urgent')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show table' }))
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(3)
  })

  it('requests the selected period and shows a dash when no rate exists', async () => {
    const { calls } = mockApi(signedInRoutes())
    const { user } = renderApp('/personal/analytics')

    expect(await screen.findByText('—')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: '30 days' }))
    await waitFor(() =>
      expect(
        calls.some((c) => c.path === '/me/dashboard' && c.query?.get('period') === '30d'),
      ).toBe(true),
    )
  })
})
