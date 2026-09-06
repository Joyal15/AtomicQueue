import { useEffect, useRef, useState, type ReactNode } from 'react'

import type { Business } from '@queueless/shared-types'

import { apiFetch, ApiRequestError } from './api'
import {
  AuthContext,
  type AuthState,
  type AuthUser,
} from './auth-context-value'

// Cached in sessionStorage for display only — the real credential is the
// HttpOnly session cookie, not this.
const STORAGE_KEY = 'atomicqueue.auth.user'

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

  // Bumped by anything more authoritative than the mount-time bootstrap
  // fetch (a login/signup's setSession, a signOut) so that fetch's
  // result — if it's still in flight or was duplicated by React 19
  // Strict Mode's double effect-invocation — can recognize it's stale
  // and skip its setState instead of clobbering the newer state. Without
  // this, logging in quickly (before the app-mount /tenants check
  // resolves) could have that check's late, unauthenticated-or-empty
  // result silently overwrite the just-set session.
  const generationRef = useRef(0)

  useEffect(() => {
    const generation = ++generationRef.current
    let cancelled = false

    async function bootstrap() {
      // No GET /api/auth/me yet, so use GET /api/tenants as a stand-in:
      // it requires a valid session, so a 200 confirms the cookie is
      // still good. The cached user fills in name/email/role until a
      // real /me endpoint exists.
      const cachedUser = readCachedUser()

      try {
        const business = await apiFetch<Business>('/tenants')
        if (cancelled || generationRef.current !== generation) return
        setState({ status: 'authenticated', user: cachedUser, business })
      } catch (error) {
        if (cancelled || generationRef.current !== generation) return

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
    generationRef.current += 1
    writeCachedUser(user)
    setState({ status: 'authenticated', user, business })
  }

  async function refreshBusiness() {
    const business = await apiFetch<Business>('/tenants')
    setState((prev) => ({ ...prev, business }))
  }

  async function signOut() {
    generationRef.current += 1

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
