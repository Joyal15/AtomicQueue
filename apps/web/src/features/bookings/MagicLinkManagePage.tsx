import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarClock, CheckCircle2, Clock, Lock } from 'lucide-react'

import { apiFetch, ApiRequestError } from '@/lib/api'
import { bookingStatusBadge, formatDateTime } from '@/lib/format'
import { Wordmark } from '@/components/brand'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'

interface ManagedBooking {
  id: string
  status: 'confirmed' | 'cancelled' | 'completed' | 'no-show'
  customer: { name: string; contactType: 'email' | 'phone'; contact: string }
  createdAt: string
  slot: {
    providerId: string
    providerType: 'staff' | 'resource'
    serviceId: string
    datetime: string
    durationMinutes: number
  } | null
  businessSlug: string | null
  accessTier: 'manage' | 'view-only'
}

interface AvailabilityBucket {
  providerId: string
  providerType: 'staff' | 'resource'
  serviceId: string
  datetime: string
  remaining: number
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'no-link' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; booking: ManagedBooking }

/**
 * Customer magic-link manage page — `/manage?bookingId=&token=`.
 * Exchanges the raw token from the URL for a `booking_access` cookie
 * (POST, never left as a query string beyond one load), scrubs the URL,
 * then loads the booking via the cookie. Cancel and reschedule route
 * through the same server functions staff use; both are gated to the
 * "manage" access tier (before the business's change cutoff).
 */
export function MagicLinkManagePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [initialBookingId] = useState(() => searchParams.get('bookingId'))
  const [initialToken] = useState(() => searchParams.get('token'))
  const [state, setState] = useState<LoadState>(
    initialBookingId && initialToken ? { kind: 'loading' } : { kind: 'no-link' },
  )
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)

  async function reload() {
    const booking = await apiFetch<ManagedBooking>('/bookings/manage')
    setState({ kind: 'loaded', booking })
  }

  useEffect(() => {
    if (!initialBookingId || !initialToken) return

    async function exchangeAndLoad(bookingId: string, token: string) {
      try {
        await apiFetch('/bookings/magic-link/exchange', {
          method: 'POST',
          body: JSON.stringify({ bookingId, token }),
        })
        setSearchParams({}, { replace: true })
        await reload()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const booking = state.kind === 'loaded' ? state.booking : null
  const canManage =
    booking?.status === 'confirmed' && booking.accessTier === 'manage'

  return (
    <div className="min-h-screen bg-hero-grid">
      <div className="mx-auto max-w-lg px-6 py-12">
        <Wordmark />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">
          Manage your booking
        </h1>

        <div className="mt-6 space-y-4">
          {state.kind === 'loading' && (
            <Card>
              <CardContent className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
                <Spinner /> Loading your booking…
              </CardContent>
            </Card>
          )}

          {state.kind === 'no-link' && <ResendForm />}

          {state.kind === 'error' && (
            <>
              <Alert variant="destructive">{state.message}</Alert>
              <ResendForm />
            </>
          )}

          {booking && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-lg">
                    {booking.slot
                      ? formatDateTime(booking.slot.datetime)
                      : 'Booking'}
                  </CardTitle>
                  <Badge variant={bookingStatusBadge[booking.status]}>
                    {booking.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  {booking.slot && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Duration</dt>
                      <dd className="font-medium">
                        {booking.slot.durationMinutes} min
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs text-muted-foreground">Booked for</dt>
                    <dd className="font-medium">{booking.customer.name}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Contact</dt>
                    <dd className="font-medium">{booking.customer.contact}</dd>
                  </div>
                </dl>

                {booking.status === 'confirmed' &&
                  booking.accessTier === 'view-only' && (
                    <Alert>
                      <span className="flex items-center gap-2">
                        <Lock className="size-4 shrink-0" />
                        Past the change cutoff — this booking is view-only now.
                        Contact the business directly if you need a change.
                      </span>
                    </Alert>
                  )}

                {booking.status !== 'confirmed' && (
                  <Alert>
                    This booking is {booking.status}. Nothing further to do
                    here.
                  </Alert>
                )}

                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setRescheduleOpen(true)}
                    >
                      <CalendarClock className="size-4" />
                      Reschedule
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => setCancelOpen(true)}
                    >
                      Cancel booking
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {booking && (
        <>
          <RescheduleDialog
            open={rescheduleOpen}
            booking={booking}
            onClose={() => setRescheduleOpen(false)}
            onDone={async () => {
              setRescheduleOpen(false)
              await reload()
            }}
          />
          <CancelDialog
            open={cancelOpen}
            booking={booking}
            onClose={() => setCancelOpen(false)}
            onDone={async () => {
              setCancelOpen(false)
              await reload()
            }}
          />
        </>
      )}
    </div>
  )
}

function RescheduleDialog({
  open,
  booking,
  onClose,
  onDone,
}: {
  open: boolean
  booking: ManagedBooking
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [buckets, setBuckets] = useState<AvailabilityBucket[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [datetime, setDatetime] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const slot = booking.slot
  const slug = booking.businessSlug

  useEffect(() => {
    if (!open || !slot || !slug) return
    setBuckets(null)
    setDatetime('')
    setError(null)
    setLoadError(null)

    async function load(currentSlug: string, s: NonNullable<ManagedBooking['slot']>) {
      try {
        const params = new URLSearchParams({
          serviceId: s.serviceId,
          providerId: s.providerId,
          providerType: s.providerType,
        })
        const data = await apiFetch<AvailabilityBucket[]>(
          `/businesses/${currentSlug}/availability?${params.toString()}`,
        )
        setBuckets(
          data
            .filter(
              (b) => b.remaining > 0 && b.datetime !== s.datetime,
            )
            .sort(
              (a, b) =>
                new Date(a.datetime).getTime() -
                new Date(b.datetime).getTime(),
            ),
        )
      } catch (err) {
        setLoadError(
          err instanceof ApiRequestError
            ? err.message
            : 'Could not load available times.',
        )
      }
    }
    void load(slug, slot)
  }, [open, slot, slug])

  async function handleConfirm() {
    if (!slot || !datetime) return
    setSubmitting(true)
    setError(null)
    try {
      await apiFetch('/bookings/manage/reschedule', {
        method: 'POST',
        body: JSON.stringify({
          providerId: slot.providerId,
          providerType: slot.providerType,
          serviceId: slot.serviceId,
          datetime,
        }),
      })
      await onDone()
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not reschedule. The time may have just been taken.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Reschedule"
      description={
        slot
          ? `Currently ${formatDateTime(slot.datetime)}.`
          : undefined
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Keep current time
          </Button>
          <Button onClick={handleConfirm} disabled={submitting || !datetime}>
            {submitting && <Spinner />}
            Confirm new time
          </Button>
        </>
      }
    >
      {!slug && (
        <Alert variant="destructive">
          Rescheduling isn't available for this booking online.
        </Alert>
      )}
      {error && (
        <Alert variant="destructive" className="mb-4">
          {error}
        </Alert>
      )}
      {loadError && (
        <Alert variant="destructive" className="mb-4">
          {loadError}
        </Alert>
      )}

      {slug && buckets === null && !loadError && (
        <p className="text-sm text-muted-foreground">Loading available times…</p>
      )}

      {buckets && buckets.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No other open times right now. Try again later, or contact the
          business.
        </p>
      )}

      {buckets && buckets.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="cust-reschedule-time">New time</Label>
          <Select
            id="cust-reschedule-time"
            value={datetime}
            onChange={(e) => setDatetime(e.target.value)}
          >
            <option value="" disabled>
              Select a time
            </option>
            {buckets.map((b) => (
              <option key={b.datetime} value={b.datetime}>
                {formatDateTime(b.datetime)}
              </option>
            ))}
          </Select>
        </div>
      )}
    </Dialog>
  )
}

function CancelDialog({
  open,
  booking,
  onClose,
  onDone,
}: {
  open: boolean
  booking: ManagedBooking
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setSubmitting(true)
    setError(null)
    try {
      await apiFetch('/bookings/manage/cancel', { method: 'POST' })
      await onDone()
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not cancel the booking.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Cancel this booking?"
      description="This frees the time for someone else and can't be undone."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Keep booking
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={submitting}
          >
            {submitting && <Spinner />}
            Cancel booking
          </Button>
        </>
      }
    >
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex items-center gap-3 rounded-md border border-border bg-secondary/30 px-4 py-3 text-sm">
        <Clock className="size-4 shrink-0 text-muted-foreground" />
        <span>
          {booking.slot
            ? formatDateTime(booking.slot.datetime)
            : 'Time unknown'}
        </span>
      </div>
    </Dialog>
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
      // The backend returns a neutral response regardless of match
      // (enumeration resistance) — show the same message either way.
    } finally {
      setSubmitting(false)
      setSent(true)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Get your link</CardTitle>
      </CardHeader>
      <CardContent>
        {sent ? (
          <Alert variant="success">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="size-4 shrink-0" />
              If that contact matches an upcoming booking, a link is on its
              way.
            </span>
          </Alert>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="resend-contact">
                Email or phone you booked with
              </Label>
              <Input
                id="resend-contact"
                required
                value={contact}
                onChange={(e) => setContact(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting && <Spinner />}
              {submitting ? 'Sending…' : 'Send link'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
