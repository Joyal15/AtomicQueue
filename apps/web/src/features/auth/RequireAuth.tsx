import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '@/lib/use-auth'

/**
 * Gate for authenticated routes: shows a loading state while checking
 * the session, redirects to /login if unauthenticated, otherwise
 * renders the nested route.
 */
export function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}
