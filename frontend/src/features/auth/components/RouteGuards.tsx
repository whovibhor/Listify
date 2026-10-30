import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router'

import { ErrorState } from '@/components/shared/StatePanels'
import { FullPageLoader } from '@/components/shared/FullPageLoader'
import { useMe } from '@/features/auth/api'
import { safeRedirectPath } from '@/lib/form-errors'

function SessionCheckFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="grid min-h-svh place-items-center p-4">
      <ErrorState
        className="w-full max-w-md"
        title="Can't reach WorkPulse"
        message="We couldn't check your session. Check your connection and try again."
        onRetry={onRetry}
      />
    </div>
  )
}

/** Renders child routes only for signed-in users; others go to sign-in and come back after. */
export function RequireAuth() {
  const { data: user, isPending, isError, refetch } = useMe()
  const location = useLocation()

  if (isPending) return <FullPageLoader />
  if (isError) return <SessionCheckFailed onRetry={() => void refetch()} />
  if (!user) {
    const next = `${location.pathname}${location.search}`
    const search = next === '/' ? '' : `?next=${encodeURIComponent(next)}`
    return <Navigate to={`/login${search}`} replace />
  }
  return <Outlet />
}

/** Sign-in / registration pages: signed-in users are sent on to the app. */
export function GuestOnly() {
  const { data: user, isPending, isError, refetch } = useMe()
  const [params] = useSearchParams()

  if (isPending) return <FullPageLoader />
  if (isError) return <SessionCheckFailed onRetry={() => void refetch()} />
  if (user) return <Navigate to={safeRedirectPath(params.get('next'))} replace />
  return <Outlet />
}
