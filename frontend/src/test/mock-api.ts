import { vi } from 'vitest'

import type { User } from '@/features/auth/api'
import { jsonResponse } from '@/test/render'

export const testUser: User = {
  id: 1,
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  timezone: 'Asia/Kolkata',
  theme: 'system',
  created_at: '2026-10-29T09:00:00Z',
}

export const healthyResponse = {
  status: 'ok',
  service: 'Listify API',
  version: '0.1.0',
  environment: 'test',
  checks: { database: { status: 'ok', latency_ms: 1 } },
}

type Handler = (init: RequestInit, url: URL) => Response | Promise<Response>

/**
 * Stubs fetch with a route table keyed by "METHOD /path" (path relative to /api/v1).
 * Unmatched requests fail the test loudly instead of hanging.
 */
export function mockApi(routes: Record<string, Handler | unknown>) {
  const calls: { method: string; path: string; query: URLSearchParams; body: unknown }[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost')
    const method = (init.method ?? 'GET').toUpperCase()
    const path = url.pathname.replace(/^\/api\/v1/, '')
    calls.push({
      method,
      path,
      query: url.searchParams,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    })
    const key = `${method} ${path}`
    if (!(key in routes)) throw new Error(`Unmocked API call: ${key}`)
    const route = routes[key]
    return typeof route === 'function' ? (route as Handler)(init, url) : jsonResponse(route)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, calls }
}

export const unauthenticated = () =>
  jsonResponse(
    {
      error: { code: 'unauthenticated', message: 'Please sign in', details: [], request_id: null },
    },
    401,
  )

export const noContent = () => new Response(null, { status: 204 })

export function emptyPage<T>(items: T[] = []) {
  return { items, page: 1, page_size: 25, total: items.length }
}

export const emptyDashboard = {
  period: '7d',
  period_start: '2026-10-23T18:30:00Z',
  generated_at: '2026-10-29T20:00:00Z',
  timezone: 'Asia/Kolkata',
  counts: {
    due_today: 0,
    overdue: 0,
    upcoming_7d: 0,
    open: 0,
    completed_in_period: 0,
    created_in_period: 0,
  },
  on_time: { eligible: 0, on_time: 0, rate: null },
  trend: [],
  open_by_priority: { low: 0, medium: 0, high: 0, urgent: 0 },
  open_by_status: { not_started: 0, in_progress: 0, blocked: 0 },
  definitions: {},
}

/** Routes every signed-in screen needs. */
export function signedInRoutes(extra: Record<string, Handler | unknown> = {}) {
  return {
    'GET /me': testUser,
    'GET /health': healthyResponse,
    'GET /auth/csrf': noContent,
    'GET /me/dashboard': emptyDashboard,
    'GET /me/tasks': emptyPage(),
    'GET /me/tags': [],
    'GET /me/organizations': [],
    ...extra,
  }
}
