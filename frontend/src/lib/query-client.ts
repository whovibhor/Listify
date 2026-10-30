import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/lib/api-client'
import { ME_QUERY_KEY, MY_ORGANIZATIONS_QUERY_KEY } from '@/lib/query-keys'

const MAX_RETRIES = 2

function isUnauthenticated(error: unknown) {
  return error instanceof ApiError && error.status === 401
}

export function createQueryClient() {
  // Any 401 means the session ended (expired, revoked, signed out elsewhere): clear the
  // cached user so route guards send the visitor to sign-in.
  const onAuthError = (error: unknown) => {
    if (isUnauthenticated(error)) client.setQueryData(ME_QUERY_KEY, null)
  }

  // A 403 or 404 can mean an administrator just changed this person's access while the page was
  // open: reload what they may do, so navigation and OrganizationLayout follow (PRD §13).
  const onAccessError = (error: unknown) => {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
      void client.invalidateQueries({ queryKey: MY_ORGANIZATIONS_QUERY_KEY })
    }
  }

  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        onAuthError(error)
        if (query.queryKey[0] === MY_ORGANIZATIONS_QUERY_KEY[0]) onAccessError(error)
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        onAuthError(error)
        onAccessError(error)
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        // Client errors (401/403/404/422) will not succeed on retry; network and 5xx might.
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
          return failureCount < MAX_RETRIES
        },
      },
      mutations: { retry: false },
    },
  })
  return client
}
