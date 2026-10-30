import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SystemStatusCard } from '@/features/system/components/SystemStatusCard'
import { jsonResponse, renderWithProviders } from '@/test/render'

const healthy = {
  status: 'ok',
  service: 'Listify API',
  version: '0.1.0',
  environment: 'development',
  checks: { database: { status: 'ok', latency_ms: 2.4 } },
}

afterEach(() => vi.unstubAllGlobals())

describe('SystemStatusCard', () => {
  it('shows the live status of API and database', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(healthy))),
    )

    renderWithProviders(<SystemStatusCard />)

    const dbRow = (await screen.findByText('Database (MySQL)')).closest('li')!
    expect(within(dbRow).getByText('Operational')).toBeInTheDocument()
    expect(within(dbRow).getByText('2.4 ms')).toBeInTheDocument()
  })

  it('still reads well when production hides the version', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ ...healthy, version: null, environment: null }))),
    )

    renderWithProviders(<SystemStatusCard />)

    expect(await screen.findByText('Running')).toBeInTheDocument()
    expect(screen.queryByText(/null/)).not.toBeInTheDocument()
  })

  it('reports a degraded database from a 503 health response', async () => {
    const degraded = {
      ...healthy,
      status: 'degraded',
      checks: { database: { status: 'error', latency_ms: null } },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(degraded, 503))),
    )

    renderWithProviders(<SystemStatusCard />)

    const dbRow = (await screen.findByText('Database (MySQL)')).closest('li')!
    expect(within(dbRow).getByText('Unavailable')).toBeInTheDocument()
  })

  it('shows an actionable error when the API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )

    renderWithProviders(<SystemStatusCard />)

    expect(await screen.findByRole('alert')).toHaveTextContent('API unreachable')
  })
})
