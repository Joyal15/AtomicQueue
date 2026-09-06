import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '@/lib/use-auth'
import { Spinner } from '@/components/ui/spinner'

/**
 * Gate for authenticated routes: a loading state while the session is
 * checked, a redirect to /login if unauthenticated, otherwise the
 * nested route.
 */
export function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Checking your session…
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}
