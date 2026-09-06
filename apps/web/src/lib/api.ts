// Uses relative /api/... requests: in production the frontend and API share
// one origin, and in dev Vite's proxy forwards /api/* to the backend — so
// no base-URL env var is needed either way.

// The only two response shapes this API returns.
interface ApiSuccessBody<T> {
  data: T
}

interface ApiErrorBody {
  error: {
    code: string
    message: string
    // Only present on VALIDATION_ERROR: field name -> caller-facing detail.
    fields?: Record<string, string>
    [key: string]: unknown // any other metadata an endpoint may include
  }
}

// HTTP status is carried on the thrown error so callers can branch on it
// (e.g. 401 -> redirect to login, 403 -> show a permission message)
// without re-parsing the body.
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

// ── Global 401 signal ────────────────────────────────────────────────
// A 401 anywhere means the session cookie is gone or expired. Rather
// than have every caller re-implement "bounce to login", `apiFetch`
// notifies these listeners and the auth provider handles it centrally
// (architecture doc §13: on 401 clear local auth state and redirect to
// login; on 403 stay put).
type UnauthorizedListener = () => void
const unauthorizedListeners = new Set<UnauthorizedListener>()

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener)
  return () => unauthorizedListeners.delete(listener)
}

function notifyUnauthorized(): void {
  for (const listener of unauthorizedListeners) {
    try {
      listener()
    } catch {
      // a listener throwing must not break the fetch caller's own error path
    }
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
    if (response.status === 401) {
      notifyUnauthorized()
    }
    // An error response always carries { error: { code, message } }.
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
