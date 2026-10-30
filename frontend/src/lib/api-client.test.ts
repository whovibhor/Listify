import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api } from '@/lib/api-client'
import { jsonResponse } from '@/test/render'

function mockFetch(response: Response | Error) {
  const fn = vi.fn(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.cookie = 'listify_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

describe('api client', () => {
  it('prefixes the API base URL, sends credentials and drops empty query params', async () => {
    const fetchMock = mockFetch(jsonResponse({ ok: true }))

    await api.get('/me/tasks', { query: { status: 'open', tag: '', page: 2 } })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/v1/me/tasks?status=open&page=2')
    expect(init.credentials).toBe('include')
  })

  it('parses the backend error envelope into ApiError', async () => {
    mockFetch(
      jsonResponse(
        {
          error: {
            code: 'validation_error',
            message: 'Request validation failed',
            details: [{ field: 'title', message: 'Field required' }],
            request_id: 'req-1',
          },
        },
        422,
      ),
    )

    const error = await api.post('/me/tasks', {}).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 422,
      code: 'validation_error',
      requestId: 'req-1',
      details: [{ field: 'title', message: 'Field required' }],
    })
  })

  it('attaches the CSRF token header on unsafe methods only', async () => {
    document.cookie = 'listify_csrf=token-123'
    const fetchMock = mockFetch(jsonResponse({}))

    await api.post('/auth/logout')
    await api.get('/me')

    const postHeaders = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
      .headers as Headers
    const getHeaders = (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1]
      .headers as Headers
    expect(postHeaders.get('X-CSRF-Token')).toBe('token-123')
    expect(getHeaders.get('X-CSRF-Token')).toBeNull()
  })

  it('maps network failures to a friendly network ApiError', async () => {
    mockFetch(new TypeError('Failed to fetch'))

    const error = await api.get('/health').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).isNetworkError).toBe(true)
    expect((error as ApiError).code).toBe('network_error')
  })
})
