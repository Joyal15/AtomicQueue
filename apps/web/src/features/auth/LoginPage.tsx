import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import type { Business } from '@queueless/shared-types'

import { apiFetch, ApiRequestError } from '@/lib/api'
import { useAuth } from '@/lib/use-auth'
import type { AuthUser } from '@/lib/auth-context-value'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface LoginResponse {
  user: AuthUser
  business: Business
}

/**
 * Owner/staff login — POST /api/auth/login.
 *
 * NOTE: this endpoint doesn't exist on the backend yet (Peter 1's Phase 2
 * checklist — only /api/auth/signup is built so far). This form is wired
 * against the shape signup already uses ({email, password} in, {user,
 * business} out) since that's the only reasonable contract to assume —
 * it will start working with zero frontend changes the moment /login
 * ships. Until then this correctly shows a clean error, not a crash.
 */
export function LoginPage() {
  const navigate = useNavigate()
  const { setSession } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const result = await apiFetch<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })

      setSession(result.user, result.business)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message)
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Log in</CardTitle>
          <CardDescription>Sign in to your business dashboard.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            {error && <Alert variant="destructive">{error}</Alert>}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Logging in…' : 'Log in'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            No account yet?{' '}
            <Link to="/signup" className="font-medium text-foreground underline underline-offset-4">
              Create a business
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
