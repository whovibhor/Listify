import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, api } from '@/lib/api-client'
import { ME_QUERY_KEY } from '@/lib/query-keys'

export interface User {
  id: number
  email: string
  name: string
  timezone: string
  theme: 'light' | 'dark' | 'system'
  sidebar_collapsed: boolean
  /** The workspace to reopen; null means Personal. */
  last_organization_id: number | null
  created_at: string
}

type Preferences = Pick<User, 'theme' | 'sidebar_collapsed' | 'last_organization_id'>

export interface UserSession {
  id: number
  created_at: string
  last_seen_at: string
  ip_address: string | null
  user_agent: string | null
  current: boolean
}

export interface RegisterInput {
  name: string
  email: string
  password: string
  timezone: string
  accept_terms: true
}

export const authKeys = {
  me: ME_QUERY_KEY,
  sessions: ['auth', 'sessions'] as const,
}

/** Current user, or null when signed out (401 is an expected state, not an error). */
export async function fetchMe(): Promise<User | null> {
  try {
    return await api.get<User>('/me')
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

export function useMe() {
  return useQuery({ queryKey: authKeys.me, queryFn: fetchMe, staleTime: 5 * 60_000 })
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      api.post<User>('/auth/login', input),
    onSuccess: (user) => {
      // A different account may have been cached before; start clean.
      queryClient.clear()
      queryClient.setQueryData(authKeys.me, user)
    },
  })
}

export function useRegister() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: RegisterInput) => api.post<User>('/auth/register', input),
    onSuccess: (user) => {
      queryClient.clear()
      queryClient.setQueryData(authKeys.me, user)
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSettled: () => {
      queryClient.clear()
      queryClient.setQueryData(authKeys.me, null)
    },
  })
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (input: { email: string }) =>
      api.post<{ message: string }>('/auth/password/forgot', input),
  })
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (input: { token: string; password: string }) =>
      api.post<void>('/auth/password/reset', input),
  })
}

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { name?: string; timezone?: string }) => api.patch<User>('/me', input),
    onSuccess: (user) => queryClient.setQueryData(authKeys.me, user),
  })
}

/** Saves preferences to the account (MySQL) so they follow the user to every device. */
export function useUpdatePreferences() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<Preferences>) => api.patch<Preferences>('/me/preferences', input),
    // Applied straight away, so the interface never waits for the save.
    onMutate: (input) => {
      const previous = queryClient.getQueryData<User | null>(authKeys.me)
      if (previous) queryClient.setQueryData<User>(authKeys.me, { ...previous, ...input })
      return { previous }
    },
    onError: (_error, _input, context) => queryClient.setQueryData(authKeys.me, context?.previous),
    onSuccess: (prefs) =>
      queryClient.setQueryData<User | null>(authKeys.me, (user) =>
        user ? { ...user, ...prefs } : user,
      ),
  })
}

export function useChangePassword() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { current_password: string; new_password: string }) =>
      api.post<void>('/me/password', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authKeys.sessions }),
  })
}

export function useSessions() {
  return useQuery({
    queryKey: authKeys.sessions,
    queryFn: () => api.get<UserSession[]>('/me/sessions'),
  })
}

export function useRevokeSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (sessionId: number) => api.delete<void>(`/me/sessions/${sessionId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authKeys.sessions }),
  })
}
