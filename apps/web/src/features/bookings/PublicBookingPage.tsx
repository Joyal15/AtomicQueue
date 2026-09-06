import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CalendarOff, CheckCircle2, Clock } from 'lucide-react'

import { apiFetch, ApiRequestError } from '@/lib/api'
import { useSlotUpdates } from '@/lib/realtime'
import { getBookingSessionId } from '@/lib/session-id'
import { formatPrice, formatTime, groupByDay } from '@/lib/format'
import { cn } from '@/lib/utils'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'

interface PublicService {
  id: string
  name: string
  durationMinutes: number
  price: number
}

interface PublicProvider {
  providerId: string
  providerType: 'staff' | 'resource'
  name: string
  capacity: number
}

interface PublicBusiness {
  id: string
  name: string
  slug: string
}

interface AvailabilityBucket {
  providerId: string
  providerType: 'staff' | 'resource'
  serviceId: string
  datetime: string
  durationMinutes: number
  total: number
  remaining: number
}

function providerKey(providerId: string, providerType: string): string {
  return `${providerType}:${providerId}`
}

function bucketKey(b: { providerId: string; datetime: string }): string {
  return `${b.providerId}@${b.datetime}`
}

/**
 * Public, unauthenticated booking page — `/b/:slug`. Real end-to-end:
 * browse live availability, place a fenced Redis hold on a time, confirm
 * with contact details. A lost race (someone else claims the last unit)
 * surfaces the waitlist instead. Live-updates the remaining counts over
 * Socket.IO with no polling — the "money demo" (architecture doc §12).
 */
export function PublicBookingPage() {
  const { slug } = useParams<{ slug: string }>()
  const [sessionId] = useState(getBookingSessionId)

  const [business, setBusiness] = useState<PublicBusiness | null>(null)
  const [businessError, setBusinessError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)

  const [services, setServices] = useState<PublicService[] | null>(null)
  const [providers, setProviders] = useState<PublicProvider[] | null>(null)

  const [serviceId, setServiceId] = useState('')
  const [providerKeyValue, setProviderKeyValue] = useState('')

  const [buckets, setBuckets] = useState<AvailabilityBucket[] | null>(null)
  const [bucketsError, setBucketsError] = useState<string | null>(null)
  const [loadedAvailabilityKey, setLoadedAvailabilityKey] = useState<
    string | null
  >(null)

  const [booking, setBooking] = useState<AvailabilityBucket | null>(null)
  const [waitlistFor, setWaitlistFor] = useState<AvailabilityBucket | null>(null)

  const selectedProvider = useMemo(
    () =>
      providers?.find(
        (p) => providerKey(p.providerId, p.providerType) === providerKeyValue,
      ) ?? null,
    [providers, providerKeyValue],
  )

  const availabilityKey = serviceId ? `${serviceId}:${providerKeyValue}` : null
  if (availabilityKey && loadedAvailabilityKey !== availabilityKey) {
    setLoadedAvailabilityKey(availabilityKey)
    setBuckets(null)
  }

  const loadAvailability = useCallback(async () => {
    if (!slug || !serviceId) return
    try {
      const params = new URLSearchParams({ serviceId })
      if (selectedProvider) {
        params.set('providerId', selectedProvider.providerId)
        params.set('providerType', selectedProvider.providerType)
      }
      const data = await apiFetch<AvailabilityBucket[]>(
        `/businesses/${slug}/availability?${params.toString()}`,
      )
      setBuckets(
        [...data].sort(
          (a, b) =>
            new Date(a.datetime).getTime() - new Date(b.datetime).getTime(),
        ),
      )
      setBucketsError(null)
    } catch (err) {
      setBucketsError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not load availability.',
      )
    }
  }, [slug, serviceId, selectedProvider])

  useEffect(() => {
    if (!slug) return
    async function load() {
      try {
        const [businessData, servicesData, providersData] = await Promise.all([
          apiFetch<PublicBusiness>(`/businesses/${slug}`),
          apiFetch<PublicService[]>(`/businesses/${slug}/services`),
          apiFetch<PublicProvider[]>(`/businesses/${slug}/providers`),
        ])
        setBusiness(businessData)
        setServices(servicesData)
        setProviders(providersData)
        if (servicesData.length > 0) setServiceId(servicesData[0].id)
        setBusinessError(null)
        setNotFound(false)
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 404) {
          setNotFound(true)
          return
        }
        setBusinessError(
          err instanceof ApiRequestError
            ? err.message
            : 'Could not load this business.',
        )
      }
    }
    void load()
  }, [slug])

  useEffect(() => {
    async function run() {
      await loadAvailability()
    }
    void run()
  }, [loadAvailability])

  // Live: patch the matching bucket's remaining count as claims land
  // elsewhere — no refetch, no polling.
  useSlotUpdates((payload) => {
    if (!('remaining' in payload)) return
    setBuckets(
      (current) =>
        current?.map((b) =>
          b.providerId === payload.providerId &&
          b.providerType === payload.providerType &&
          b.datetime === payload.datetime
            ? { ...b, remaining: payload.remaining }
            : b,
        ) ?? current,
    )
  }, slug)

  if (notFound) {
    return (
      <div className="grid min-h-screen place-items-center bg-hero-grid px-6">
        <div className="text-center">
          <CalendarOff className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-lg font-semibold">Business not found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Double-check the link — this booking page doesn't exist.
          </p>
        </div>
      </div>
    )
  }

  const days = buckets ? groupByDay(buckets) : []

  return (
    <div className="min-h-screen bg-hero-grid">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <Wordmark />

        <div className="mt-8">
          {!business && !businessError ? (
            <Skeleton className="h-9 w-56" />
          ) : (
            <h1 className="text-3xl font-bold tracking-tight">
              {business?.name ?? 'Book an appointment'}
            </h1>
          )}
          <p className="mt-1.5 text-sm text-muted-foreground">
            Pick a service and a time — we'll hold it for 5 minutes while you
            confirm.
          </p>
        </div>

        {businessError && (
          <Alert variant="destructive" className="mt-6">
            {businessError}
          </Alert>
        )}

        {services && services.length === 0 && (
          <Alert className="mt-6">
            This business hasn't set up any bookable services yet.
          </Alert>
        )}

        {services && services.length > 0 && (
          <div className="mt-6 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Choose a service</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="public-service">Service</Label>
                    <Select
                      id="public-service"
                      value={serviceId}
                      onChange={(e) => setServiceId(e.target.value)}
                    >
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} · {s.durationMinutes} min ·{' '}
                          {formatPrice(s.price)}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="public-provider">Provider</Label>
                    <Select
                      id="public-provider"
                      value={providerKeyValue}
                      onChange={(e) => setProviderKeyValue(e.target.value)}
                    >
                      <option value="">Any provider</option>
                      {providers?.map((p) => (
                        <option
                          key={providerKey(p.providerId, p.providerType)}
                          value={providerKey(p.providerId, p.providerType)}
                        >
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Available times</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {bucketsError && (
                  <Alert variant="destructive">{bucketsError}</Alert>
                )}

                {buckets === null && !bucketsError && (
                  <div className="space-y-3">
                    <Skeleton className="h-4 w-32" />
                    <div className="flex flex-wrap gap-2">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-9 w-24" />
                      ))}
                    </div>
                  </div>
                )}

                {buckets?.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No upcoming times for this service right now.
                  </p>
                )}

                {days.map((day) => (
                  <div key={day.key}>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {day.label}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {day.items.map((bucket) => {
                        const full = bucket.remaining === 0
                        const multi = bucket.total > 1
                        return (
                          <button
                            key={bucketKey(bucket)}
                            type="button"
                            onClick={() =>
                              full
                                ? setWaitlistFor(bucket)
                                : setBooking(bucket)
                            }
                            className={cn(
                              'inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                              full
                                ? 'border-border bg-secondary/50 text-muted-foreground hover:border-primary/30'
                                : 'border-input bg-card hover:border-primary hover:bg-accent',
                            )}
                          >
                            {formatTime(bucket.datetime)}
                            {multi && (
                              <Badge
                                variant={full ? 'destructive' : 'success'}
                                className="px-1.5 py-0"
                              >
                                {bucket.remaining}/{bucket.total}
                              </Badge>
                            )}
                            {!multi && full && (
                              <Badge
                                variant="destructive"
                                className="px-1.5 py-0"
                              >
                                full
                              </Badge>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {booking && slug && (
        <BookingDialog
          slug={slug}
          sessionId={sessionId}
          bucket={booking}
          onClose={() => {
            setBooking(null)
            void loadAvailability()
          }}
          onSlotLost={(b) => {
            setBooking(null)
            void loadAvailability()
            setWaitlistFor(b)
          }}
        />
      )}

      {waitlistFor && business && (
        <WaitlistDialog
          businessId={business.id}
          bucket={waitlistFor}
          onClose={() => setWaitlistFor(null)}
        />
      )}
    </div>
  )
}

type BookingStep = 'holding' | 'form' | 'submitting' | 'done'

function BookingDialog({
  slug,
  sessionId,
  bucket,
  onClose,
  onSlotLost,
}: {
  slug: string
  sessionId: string
  bucket: AvailabilityBucket
  onClose: () => void
  onSlotLost: (b: AvailabilityBucket) => void
}) {
  const [step, setStep] = useState<BookingStep>('holding')
  const [error, setError] = useState<string | null>(null)
  const [heldUntil, setHeldUntil] = useState<number | null>(null)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [result, setResult] = useState<{ bookingId: string; accessToken: string } | null>(
    null,
  )

  const [name, setName] = useState('')
  const [contactType, setContactType] = useState<'email' | 'phone'>('email')
  const [contact, setContact] = useState('')

  // Step 1: place the hold on open.
  useEffect(() => {
    let cancelled = false
    async function hold() {
      try {
        const res = await apiFetch<{ heldUntil: string }>('/bookings/hold', {
          method: 'POST',
          body: JSON.stringify({
            slug,
            providerId: bucket.providerId,
            providerType: bucket.providerType,
            serviceId: bucket.serviceId,
            datetime: bucket.datetime,
            sessionId,
          }),
        })
        if (cancelled) return
        setHeldUntil(new Date(res.heldUntil).getTime())
        setStep('form')
      } catch (err) {
        if (cancelled) return
        if (err instanceof ApiRequestError && err.status === 409) {
          onSlotLost(bucket)
          return
        }
        setError(
          err instanceof ApiRequestError
            ? err.message
            : 'Could not hold this time. Please try again.',
        )
      }
    }
    void hold()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Countdown.
  useEffect(() => {
    if (heldUntil === null) return
    function tick() {
      const left = Math.max(0, Math.round((heldUntil! - Date.now()) / 1000))
      setSecondsLeft(left)
      if (left <= 0) setError('Your hold expired. Please pick a time again.')
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [heldUntil])

  const expired = secondsLeft !== null && secondsLeft <= 0

  async function handleConfirm(event: FormEvent) {
    event.preventDefault()
    if (expired) return
    setStep('submitting')
    setError(null)
    try {
      const res = await apiFetch<{ bookingId: string; accessToken: string }>(
        '/bookings/confirm',
        {
          method: 'POST',
          body: JSON.stringify({
            slug,
            providerId: bucket.providerId,
            providerType: bucket.providerType,
            serviceId: bucket.serviceId,
            datetime: bucket.datetime,
            sessionId,
            customer: { name, contactType, contact },
          }),
        },
      )
      setResult(res)
      setStep('done')
    } catch (err) {
      setStep('form')
      setError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not confirm the booking.',
      )
    }
  }

  const manageUrl = result
    ? `/manage?bookingId=${result.bookingId}&token=${encodeURIComponent(result.accessToken)}`
    : ''

  const when = new Date(bucket.datetime).toLocaleString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  return (
    <Dialog
      open
      onClose={onClose}
      title={step === 'done' ? 'Booking confirmed' : 'Confirm your booking'}
      description={step === 'done' ? undefined : when}
      footer={
        step === 'done' ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="confirm-booking-form"
              disabled={step !== 'form' || expired}
            >
              {step === 'submitting' && <Spinner />}
              Confirm booking
            </Button>
          </>
        )
      }
    >
      {step === 'holding' && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Holding this time…
        </p>
      )}

      {(step === 'form' || step === 'submitting') && (
        <div className="space-y-4">
          {secondsLeft !== null && !expired && (
            <div className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
              <Clock className="size-4" />
              Held for {Math.floor(secondsLeft / 60)}:
              {String(secondsLeft % 60).padStart(2, '0')}
            </div>
          )}
          {error && <Alert variant="destructive">{error}</Alert>}

          <form id="confirm-booking-form" className="space-y-4" onSubmit={handleConfirm}>
            <div className="space-y-2">
              <Label htmlFor="cust-name">Name</Label>
              <Input
                id="cust-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
              <div className="space-y-2">
                <Label htmlFor="cust-contact-type">Contact</Label>
                <Select
                  id="cust-contact-type"
                  value={contactType}
                  onChange={(e) =>
                    setContactType(e.target.value as 'email' | 'phone')
                  }
                >
                  <option value="email">Email</option>
                  <option value="phone">Phone</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cust-contact">
                  {contactType === 'email' ? 'Email address' : 'Phone number'}
                </Label>
                <Input
                  id="cust-contact"
                  required
                  type={contactType === 'email' ? 'email' : 'tel'}
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                />
              </div>
            </div>
            {contactType === 'phone' && (
              <p className="text-xs text-muted-foreground">
                Phone bookings can't be self-managed online — the business will
                handle any changes for you.
              </p>
            )}
          </form>
        </div>
      )}

      {step === 'done' && result && (
        <div className="space-y-4">
          <Alert variant="success">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="size-4 shrink-0" />
              You're booked for {when}.
            </span>
          </Alert>
          {contactType === 'email' ? (
            <p className="text-sm text-muted-foreground">
              A confirmation with a manage link is on its way to your email.
              You can also{' '}
              <Link
                to={manageUrl}
                className="font-medium text-primary underline underline-offset-4"
              >
                manage this booking now
              </Link>
              .
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Contact the business directly if you need to change or cancel
              this booking.
            </p>
          )}
        </div>
      )}
    </Dialog>
  )
}

function WaitlistDialog({
  businessId,
  bucket,
  onClose,
}: {
  businessId: string
  bucket: AvailabilityBucket
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await apiFetch('/waitlist', {
        method: 'POST',
        body: JSON.stringify({
          businessId,
          customer: { name, contact },
          desiredServiceId: bucket.serviceId,
          desiredProviderId: bucket.providerId,
        }),
      })
      setDone(true)
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not join the waitlist.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Join the waitlist"
      description={`${formatTime(bucket.datetime)} · ${new Date(
        bucket.datetime,
      ).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })} — we'll email you the moment it opens up.`}
      footer={
        done ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" form="waitlist-form" disabled={submitting}>
              {submitting && <Spinner />}
              Join waitlist
            </Button>
          </>
        )
      }
    >
      {done ? (
        <Alert variant="success">
          You're on the list — we'll email you if this time opens up.
        </Alert>
      ) : (
        <form id="waitlist-form" className="space-y-4" onSubmit={handleSubmit}>
          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="space-y-2">
            <Label htmlFor="waitlist-name">Name</Label>
            <Input
              id="waitlist-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="waitlist-contact">Email</Label>
            <Input
              id="waitlist-contact"
              type="email"
              required
              value={contact}
              onChange={(e) => setContact(e.target.value)}
            />
          </div>
        </form>
      )}
    </Dialog>
  )
}
