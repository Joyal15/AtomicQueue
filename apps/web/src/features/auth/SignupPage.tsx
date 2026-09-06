import { useState, type ComponentProps, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

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

interface SignupResponse {
  user: AuthUser
  business: Business
}

/**
 * Owner signup — POST /api/auth/signup. Creates the owner user and the
 * business together; there's no separate "create business" step.
 */
export function SignupPage() {
  const navigate = useNavigate()
  const { setSession } = useAuth()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setFieldErrors({})

    try {
      const result = await apiFetch<SignupResponse>('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ name, email, password, businessName }),
      })

      setSession(result.user, result.business)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message)
        setFieldErrors(err.fields ?? {})
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      title="Create your business"
      subtitle="Sign up as the owner — this creates your account and your business together."
      footer={
        <>
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Log in
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {error && <Alert variant="destructive">{error}</Alert>}

        <Field
          id="businessName"
          label="Business name"
          value={businessName}
          onChange={setBusinessName}
          error={fieldErrors.businessName}
          autoComplete="organization"
        />
        <Field
          id="name"
          label="Your name"
          value={name}
          onChange={setName}
          error={fieldErrors.name}
          autoComplete="name"
        />
        <Field
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          error={fieldErrors.email}
          autoComplete="email"
        />
        <Field
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          error={fieldErrors.password}
          minLength={8}
          autoComplete="new-password"
          hint="At least 8 characters."
        />

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting && <Spinner />}
          {submitting ? 'Creating…' : 'Create business'}
        </Button>
      </form>
    </AuthShell>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  type = 'text',
  ...rest
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  error?: string
  hint?: string
  type?: string
} & Omit<ComponentProps<'input'>, 'id' | 'value' | 'onChange' | 'type'>) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}
