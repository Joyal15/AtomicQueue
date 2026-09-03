import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '@/lib/auth-context'

/**
 * Gate for every authenticated route. Renders a loading state while the
 * auth bootstrap (see auth-context.tsx) is checking session validity,
 * redirects to /login if it comes back unauthenticated, and otherwise
 * renders the nested route via <Outlet />.
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
