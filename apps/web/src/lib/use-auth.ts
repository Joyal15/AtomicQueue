import { useContext } from 'react'

import { AuthContext, type AuthContextValue } from './auth-context-value'

/**
 * Split into its own file (rather than living in auth-context.tsx
 * alongside the `AuthProvider` component) because
 * react-refresh/only-export-components requires a file that exports a
 * component to export *only* components — same reason
 * components/ui/badge-variants.ts is split out from badge.tsx.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
