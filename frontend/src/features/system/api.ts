import { useQuery } from '@tanstack/react-query'

import { ApiError, api } from '@/lib/api-client'

export type DependencyState = 'ok' | 'error'

export interface HealthResponse {
  status: 'ok' | 'degraded'
  service: string
  // Hidden in production.
  version: string | null
  environment: string | null
  checks: Record<string, { status: DependencyState; latency_ms: number | null }>
}

export const systemKeys = {
  health: ['system', 'health'] as const,
}

function isHealthResponse(value: unknown): value is HealthResponse {
  return typeof value === 'object' && value !== null && 'checks' in value && 'status' in value
}

export async function fetchHealth(): Promise<HealthResponse> {
  try {
    return await api.get<HealthResponse>('/health')
  } catch (error) {
    // 503 still carries a full health report (API up, a dependency down).
    if (error instanceof ApiError && error.status === 503 && isHealthResponse(error.body)) {
      return error.body
    }
    throw error
  }
}

export function useHealth() {
  return useQuery({ queryKey: systemKeys.health, queryFn: fetchHealth, refetchInterval: 30_000 })
}
