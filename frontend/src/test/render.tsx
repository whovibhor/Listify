import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router'

import { AppProviders } from '@/app/providers'
import { routes as appRoutes } from '@/app/routes'
import { createQueryClient } from '@/lib/query-client'

/** Renders the real route tree at `path` inside the real providers. */
export function renderApp(path = '/', routes: RouteObject[] = appRoutes) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  // The real client (incl. its global 401 handling), minus retries so failures surface at once.
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  })
  const user = userEvent.setup()
  const result = render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return { ...result, user, router, queryClient }
}

/** Renders a single element inside providers and a memory router. */
export function renderWithProviders(ui: ReactElement, path = '/') {
  return renderApp(path, [{ path: '*', element: ui }])
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
