import { createContext } from 'react'

import type { Business } from '@queueless/shared-types'

/**
 * The signup/login response carries more fields than the shared `User`
 * type declares, so it's typed locally here instead.
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

// Split out so auth-context.tsx only exports the `AuthProvider` component
// (react-refresh requires that). Both `AuthProvider` and `useAuth` import
// the context from here.
export const AuthContext = createContext<AuthContextValue | null>(null)
