// Relative /api/... requests — true same-origin under the locked deployment topology
// (architecture doc Section 14): production serves the built frontend and the API from
// one Express origin, so a relative path just works. Local dev keeps the frontend on
// Vite's own dev server for fast HMR; Vite's dev-server proxy (vite.config.ts) forwards
// /api/* to the backend so the exact same relative-path calls work unchanged in both
// environments — no VITE_API_URL/base-URL env var needed either way.

// Locked API response contract (architecture doc Section 13 / Decision #18) — the ONLY
// two response shapes anywhere in this API, no other format and no compatibility layer
// for the earlier { status: 'ok' | 'error' } shape this replaces.
interface ApiSuccessBody<T> {
  data: T
}

interface ApiErrorBody {
  error: {
    code: string
    message: string
    // Present on VALIDATION_ERROR only (Section 13) — field name -> safe, caller-facing detail.
    fields?: Record<string, string>
    [key: string]: unknown // any other safe metadata the contract allows per-endpoint
  }
}

// HTTP status is the authoritative signal (400/401/403/404/409/429/500, Section 13) —
// carried on the thrown error as `status` so callers can branch on it (e.g. 401 -> clear
// auth state and redirect to login, 403 -> show an in-context permission message, per
// Section 13's explicit 401-vs-403 frontend-behavior rule) without re-parsing the body.
export class ApiRequestError extends Error {
  status: number
  code: string
  fields?: Record<string, string>

  constructor(message: string, status: number, code: string, fields?: Record<string, string>) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
    this.fields = fields
  }
}

function isApiErrorBody(body: unknown): body is ApiErrorBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof (body as { error?: unknown }).error === 'object' &&
    (body as { error: unknown }).error !== null
  )
}

function isApiSuccessBody<T>(body: unknown): body is ApiSuccessBody<T> {
  return typeof body === 'object' && body !== null && 'data' in body
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    // A 500 (or any other error status) only ever carries { error: { code, message } } per
    // the locked contract — there is nothing further to strip or hide here, the backend
    // itself never sends stack traces/internals in the body (Section 13).
    if (isApiErrorBody(body)) {
      throw new ApiRequestError(body.error.message, response.status, body.error.code, body.error.fields)
    }
    throw new ApiRequestError(`API request failed: ${response.status}`, response.status, 'UNKNOWN_ERROR')
  }

  if (!isApiSuccessBody<T>(body)) {
    throw new ApiRequestError('Malformed API response', response.status, 'MALFORMED_RESPONSE')
  }

  return body.data
}
