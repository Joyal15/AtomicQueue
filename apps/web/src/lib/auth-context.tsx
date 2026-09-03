import { useEffect, useState, type ReactNode } from 'react'

import type { Business } from '@queueless/shared-types'

import { apiFetch, ApiRequestError } from './api'
import {
  AuthContext,
  type AuthState,
  type AuthUser,
} from './auth-context-value'

// Session-scoped, not localStorage: this is a display-only cache of the
// last-known profile, never the credential itself (that's the HttpOnly
// session cookie, which JS can't read regardless).
const STORAGE_KEY = 'queueless.auth.user'

function readCachedUser(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

function writeCachedUser(user: AuthUser | null) {
  try {
    if (user) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(user))
    } else {
      sessionStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // sessionStorage can throw (private browsing, storage disabled) —
    // the session cookie is still the real credential either way; this
    // only affects whether name/role survive a page refresh.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    user: null,
    business: null,
  })

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      // There is no GET /api/auth/me yet, so a page load/refresh can't
      // independently ask "who am I." GET /api/tenants is the closest
      // working substitute — it requires a valid session and returns
      // the business tied to it, so a 200 confirms the session cookie
      // is still good. The user's own name/email/role only survive a
      // refresh via the cached snapshot below — a stopgap until a real
      // /me exists (same "stopgap, not silently assumed" spirit as the
      // backend's own documented workarounds).
      const cachedUser = readCachedUser()

      try {
        const business = await apiFetch<Business>('/tenants')
        if (cancelled) return
        setState({ status: 'authenticated', user: cachedUser, business })
      } catch (error) {
        if (cancelled) return

        if (error instanceof ApiRequestError && error.status === 401) {
          writeCachedUser(null)
          setState({ status: 'unauthenticated', user: null, business: null })
          return
        }

        // A non-401 failure (network blip, 500) shouldn't force a
        // logged-in user back to the login screen — only an explicit
        // 401 means "the session is actually invalid."
        setState({
          status: cachedUser ? 'authenticated' : 'unauthenticated',
          user: cachedUser,
          business: null,
        })
      }
    }

    bootstrap()

    return () => {
      cancelled = true
    }
  }, [])

  function setSession(user: AuthUser, business: Business) {
    writeCachedUser(user)
    setState({ status: 'authenticated', user, business })
  }

  async function refreshBusiness() {
    const business = await apiFetch<Business>('/tenants')
    setState((prev) => ({ ...prev, business }))
  }

  async function signOut() {
    try {
      // /api/auth/logout doesn't exist yet either — best-effort call,
      // clear local state regardless of the outcome so the UI reflects
      // "signed out" even before the backend has a route for it.
      await apiFetch('/auth/logout', { method: 'POST' })
    } catch {
      // ignore — see comment above
    }

    writeCachedUser(null)
    setState({ status: 'unauthenticated', user: null, business: null })
  }

  return (
    <AuthContext.Provider
      value={{ ...state, setSession, refreshBusiness, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}
