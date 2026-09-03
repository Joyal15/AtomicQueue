import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

import type { Business } from '@queueless/shared-types'

import { apiFetch, ApiRequestError } from './api'

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

interface AuthState {
  status: 'loading' | 'authenticated' | 'unauthenticated'
  user: AuthUser | null
  business: Business | null
}

interface AuthContextValue extends AuthState {
  /** Call right after a successful signup/login response. */
  setSession: (user: AuthUser, business: Business) => void
  /** Re-fetches just the business half (e.g. after editing settings). */
  refreshBusiness: () => Promise<void>
  /** Best-effort sign-out — clears local state either way. */
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

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

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
