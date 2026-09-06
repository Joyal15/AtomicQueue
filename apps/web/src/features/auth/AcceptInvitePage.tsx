import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import type { Business } from '@queueless/shared-types'

import { apiFetch, ApiRequestError } from '@/lib/api'
import { useAuth } from '@/lib/use-auth'
import type { AuthUser } from '@/lib/auth-context-value'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { AuthShell } from './AuthShell'

/**
 * Staff invitation acceptance — `/accept?token=...`. Posts the raw token
 * (from the URL) plus a chosen name/password to
 * `POST /api/staff/invitations/:token/accept`, which runs the acceptance
 * transaction (architecture doc §9b) and issues a session on success.
 */
export function AcceptInvitePage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { setSession } = useAuth()
  const [token] = useState(() => params.get('token') ?? '')

  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const { user } = await apiFetch<{ user: AuthUser }>(
        `/staff/invitations/${encodeURIComponent(token)}/accept`,
        { method: 'POST', body: JSON.stringify({ name, password }) },
      )
      // The session cookie is set now — resolve the business half.
      const business = await apiFetch<Business>('/tenants')
      setSession(user, business)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.status === 404
            ? 'This invitation link is invalid or has expired.'
            : err.message
          : 'Something went wrong. Please try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (!token) {
    return (
      <AuthShell
        title="Accept your invitation"
        subtitle="This link is missing its invitation token."
        footer={
          <Link
            to="/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Go to log in
          </Link>
        }
      >
        <Alert variant="destructive">
          Open the invitation link exactly as it was sent to you.
        </Alert>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Accept your invitation"
      subtitle="Set a name and password to create your staff account."
      footer={
        <Link
          to="/login"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Already set up? Log in
        </Link>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {error && <Alert variant="destructive">{error}</Alert>}

        <div className="space-y-2">
          <Label htmlFor="accept-name">Your name</Label>
          <Input
            id="accept-name"
            required
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="accept-password">Password</Label>
          <Input
            id="accept-password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">At least 8 characters.</p>
        </div>

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting && <Spinner />}
          {submitting ? 'Setting up…' : 'Create my account'}
        </Button>
      </form>
    </AuthShell>
  )
}
