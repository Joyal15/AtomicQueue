import { useContext } from 'react'

import { AuthContext, type AuthContextValue } from './auth-context-value'

/**
 * Split out so auth-context.tsx only exports the `AuthProvider`
 * component (react-refresh requires that).
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
