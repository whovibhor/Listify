import { isRouteErrorResponse, useRouteError } from 'react-router'

import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { ErrorState } from '@/components/shared/StatePanels'

/** Catches render/loader errors below the router so one broken page never blanks the app. */
export function RouteErrorBoundary() {
  const error = useRouteError()

  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <NotFoundPage />
      </div>
    )
  }

  if (import.meta.env.DEV) console.error(error)

  return (
    <div className="mx-auto max-w-xl p-6">
      <ErrorState
        title="This page failed to load"
        message="An unexpected error occurred. Reload the page; if it keeps happening, contact support."
        onRetry={() => window.location.reload()}
      />
    </div>
  )
}
