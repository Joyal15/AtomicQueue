const API_URL = import.meta.env.VITE_API_URL

if (!API_URL) {
  throw new Error('VITE_API_URL is not configured')
}

interface ApiSuccess<T> {
  status: 'ok'
  data: T
}

interface ApiError {
  status: 'error'
  message: string
  errors?: unknown
}

type ApiResponse<T> = ApiSuccess<T> | ApiError

export class ApiRequestError extends Error {
  status: number
  errors?: unknown

  constructor(message: string, status: number, errors?: unknown) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.errors = errors
  }
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null

  if (!response.ok || !body || body.status === 'error') {
    const message = body && body.status === 'error' ? body.message : `API request failed: ${response.status}`
    throw new ApiRequestError(message, response.status, body && body.status === 'error' ? body.errors : undefined)
  }

  return body.data
}
