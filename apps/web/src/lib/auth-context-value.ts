import { createContext } from 'react'

import type { Business } from '@queueless/shared-types'

/**
 * The API's signup (and, once built, login) response carries more than
 * the shared `User` type declares (`name`, `status`) — typed locally
 * here rather than against the incomplete shared type until that's
 * reconciled on the backend.
 */
export interface AuthUser {
  id: string
  name: string
  email: string
  role: 'owner' | 'staff'
  businessId: string
  status: 'active' | 'removed'
}

export interface AuthState {
  status: 'loading' | 'authenticated' | 'unauthenticated'
  user: AuthUser | null
  business: Business | null
}

export interface AuthContextValue extends AuthState {
  /** Call right after a successful signup/login response. */
  setSession: (user: AuthUser, business: Business) => void
  /** Re-fetches just the business half (e.g. after editing settings). */
  refreshBusiness: () => Promise<void>
  /** Best-effort sign-out — clears local state either way. */
  signOut: () => Promise<void>
}

// Split into its own file: react-refresh/only-export-components requires
// a file that exports a component (auth-context.tsx's `AuthProvider`) to
// export *only* components. Both `AuthProvider` and lib/use-auth.ts's
// `useAuth` hook consume this context from here.
export const AuthContext = createContext<AuthContextValue | null>(null)
