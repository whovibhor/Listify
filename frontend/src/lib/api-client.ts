import { env } from '@/lib/env'

/** Mirrors the backend error envelope (ADR-012). */
export interface ApiErrorBody {
  code: string
  message: string
  details: { field?: string; message: string }[]
  request_id: string | null
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: ApiErrorBody['details']
  readonly requestId: string | null
  /** Parsed body for non-2xx responses that still carry a payload (e.g. 503 health). */
  readonly body: unknown

  constructor(status: number, error: ApiErrorBody, body: unknown = undefined) {
    super(error.message)
    this.name = 'ApiError'
    this.status = status
    this.code = error.code
    this.details = error.details
    this.requestId = error.request_id
    this.body = body
  }

  get isNetworkError() {
    return this.status === 0
  }
}

const CSRF_COOKIE = 'wp_csrf'
const CSRF_HEADER = 'X-CSRF-Token'
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function readCookie(name: string): string | null {
  const match = document.cookie.split('; ').find((row) => row.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null
}

type Query = Record<string, string | number | boolean | null | undefined>

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  query?: Query
}

function buildUrl(path: string, query?: Query): string {
  const url = `${env.apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

function isErrorEnvelope(value: unknown): value is { error: ApiErrorBody } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'object'
  )
}

let csrfBootstrap: Promise<void> | null = null

/** Asks the API for an anonymous CSRF cookie; concurrent callers share one request. */
function ensureCsrfCookie(force = false): Promise<void> {
  if (!force && readCookie(CSRF_COOKIE)) return Promise.resolve()
  csrfBootstrap ??= fetch(buildUrl('/auth/csrf'), { credentials: 'include' })
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      csrfBootstrap = null
    })
  return csrfBootstrap
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const isUnsafe = UNSAFE_METHODS.has((options.method ?? 'GET').toUpperCase())
  if (isUnsafe) await ensureCsrfCookie()
  try {
    return await send<T>(path, options)
  } catch (error) {
    // A stale token (e.g. cookie expired) gets one transparent refresh-and-retry.
    if (isUnsafe && error instanceof ApiError && error.code === 'csrf_failed') {
      await ensureCsrfCookie(true)
      return send<T>(path, options)
    }
    throw error
  }
}

async function send<T>(path: string, options: RequestOptions): Promise<T> {
  const { body, query, headers, method = 'GET', ...rest } = options
  const finalHeaders = new Headers(headers)
  finalHeaders.set('Accept', 'application/json')
  if (body !== undefined) finalHeaders.set('Content-Type', 'application/json')
  if (UNSAFE_METHODS.has(method.toUpperCase())) {
    const csrf = readCookie(CSRF_COOKIE)
    if (csrf) finalHeaders.set(CSRF_HEADER, csrf)
  }

  let response: Response
  try {
    response = await fetch(buildUrl(path, query), {
      ...rest,
      method,
      headers: finalHeaders,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, {
      code: 'network_error',
      message: 'Unable to reach the server. Check your connection and try again.',
      details: [],
      request_id: null,
    })
  }

  if (response.status === 204) return undefined as T

  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const error: ApiErrorBody = isErrorEnvelope(payload)
      ? payload.error
      : {
          code: 'http_error',
          message: `Request failed with status ${response.status}`,
          details: [],
          request_id: response.headers.get('X-Request-ID'),
        }
    throw new ApiError(response.status, error, payload)
  }

  return payload as T
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
}
