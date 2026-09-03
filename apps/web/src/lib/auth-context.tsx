import { useEffect, useState, type ReactNode } from 'react'

import type { Business } from '@queueless/shared-types'

import { apiFetch, ApiRequestError } from './api'
import {
  AuthContext,
  type AuthState,
  type AuthUser,
} from './auth-context-value'

// Cached in sessionStorage for display only — the real credential is the
// HttpOnly session cookie, not this.
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
    // sessionStorage can throw (private browsing, storage disabled);
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
      // No GET /api/auth/me yet, so use GET /api/tenants as a stand-in:
      // it requires a valid session, so a 200 confirms the cookie is
      // still good. The cached user fills in name/email/role until a
      // real /me endpoint exists.
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
        // logged-in user back to the login screen.
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
      // /api/auth/logout doesn't exist yet — best-effort call; local
      // state is cleared below regardless of the outcome.
      await apiFetch('/auth/logout', { method: 'POST' })
    } catch {
      // ignore
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
