import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'

import { apiFetch, ApiRequestError } from '@/lib/api'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface ManagedBooking {
  id: string
  status: 'confirmed' | 'cancelled' | 'completed' | 'no-show'
  customer: { name: string; contactType: 'email' | 'phone'; contact: string }
  createdAt: string
  slot: {
    datetime: string
    durationMinutes: number
  } | null
  accessTier: 'manage' | 'view-only'
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'no-link' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; booking: ManagedBooking }

/**
 * Customer magic-link manage page — `/manage?bookingId=&token=`.
 * Exchanges the raw token from the URL for a `booking_access` cookie
 * (POST, never left as a query string beyond this one load), scrubs
 * the URL immediately after, then loads the booking via the cookie.
 * Reschedule/cancel actions don't exist on the backend yet (Phase 4) —
 * this shows the booking and its access tier honestly rather than
 * offering buttons that don't work yet.
 */
export function MagicLinkManagePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  // Read once at module-init time from the URL present on first render —
  // whether a link was provided at all is derivable synchronously, so it
  // doesn't need an effect (only the actual exchange, a real side
  // effect, does).
  const [initialBookingId] = useState(() => searchParams.get('bookingId'))
  const [initialToken] = useState(() => searchParams.get('token'))
  const [state, setState] = useState<LoadState>(
    initialBookingId && initialToken ? { kind: 'loading' } : { kind: 'no-link' },
  )

  useEffect(() => {
    if (!initialBookingId || !initialToken) return

    async function exchangeAndLoad(bookingId: string, token: string) {
      try {
        await apiFetch('/bookings/magic-link/exchange', {
          method: 'POST',
          body: JSON.stringify({ bookingId, token }),
        })

        // Scrub the raw token from the visible URL now that it's been
        // exchanged for a cookie — it should never sit in browser
        // history/referrer headers longer than one load.
        setSearchParams({}, { replace: true })

        const booking = await apiFetch<ManagedBooking>('/bookings/manage')
        setState({ kind: 'loaded', booking })
      } catch (err) {
        setState({
          kind: 'error',
          message:
            err instanceof ApiRequestError
              ? err.status === 404
                ? 'This link is invalid or has expired.'
                : err.message
              : 'Something went wrong loading your booking.',
        })
      }
    }

    void exchangeAndLoad(initialBookingId, initialToken)
    // Only ever needs to run once, off the URL params present on load —
    // re-running after setSearchParams({}) would just loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="mx-auto max-w-lg space-y-6 px-6 py-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          QueueLess++
        </p>
        <h1 className="text-2xl font-semibold">Manage your booking</h1>
      </div>

      {state.kind === 'loading' && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {state.kind === 'no-link' && <ResendForm />}

      {state.kind === 'error' && (
        <div className="space-y-4">
          <Alert variant="destructive">{state.message}</Alert>
          <ResendForm />
        </div>
      )}

      {state.kind === 'loaded' && (
        <Card>
          <CardHeader>
            <CardTitle>
              {state.booking.slot
                ? new Date(state.booking.slot.datetime).toLocaleString()
                : 'Booking'}
            </CardTitle>
            <CardDescription>
              {state.booking.slot
                ? `${state.booking.slot.durationMinutes} min`
                : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  state.booking.status === 'confirmed' ? 'default' : 'secondary'
                }
              >
                {state.booking.status}
              </Badge>
              {state.booking.accessTier === 'view-only' && (
                <Badge variant="secondary">View only — past change cutoff</Badge>
              )}
            </div>

            <div className="text-sm text-muted-foreground">
              Booked under {state.booking.customer.name} (
              {state.booking.customer.contact})
            </div>

            <Alert>
              Reschedule and cancellation aren't available yet — check back
              soon, or contact the business directly for changes.
            </Alert>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function ResendForm() {
  const [contact, setContact] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)

    try {
      await apiFetch<{ message: string }>('/bookings/magic-link/resend', {
        method: 'POST',
        body: JSON.stringify({ contact }),
      })
    } catch {
      // Deliberately ignored: the backend already returns a neutral
      // response regardless of match (enumeration resistance) — a
      // network-level failure is the only real error case here, and
      // showing the same neutral message either way costs nothing.
    } finally {
      setSubmitting(false)
      setSent(true)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resend your link</CardTitle>
        <CardDescription>
          Enter the email or phone you booked with.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sent ? (
          <Alert>
            If that contact matches an upcoming booking, a link has been
            sent.
          </Alert>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="resend-contact">Email or phone</Label>
              <Input
                id="resend-contact"
                required
                value={contact}
                onChange={(e) => setContact(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send link'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
