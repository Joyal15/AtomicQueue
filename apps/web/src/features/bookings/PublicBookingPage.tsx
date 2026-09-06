import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { CalendarOff, Clock } from 'lucide-react'

import { apiFetch, ApiRequestError } from '@/lib/api'
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

/**
 * Public, unauthenticated booking page — `/b/:slug`. Browsing (service →
 * provider → live availability grid) is fully real, backed by the public
 * catalog/availability endpoints. It does NOT let a customer claim a
 * slot directly — there's no anonymous booking endpoint (only staff/
 * owner sessions create bookings today) — so it offers the waitlist,
 * which is real and works, rather than a dead submit button.
 */
export function PublicBookingPage() {
  const { slug } = useParams<{ slug: string }>()

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

  const [waitlistOpenFor, setWaitlistOpenFor] =
    useState<AvailabilityBucket | null>(null)

  const selectedService = useMemo(
    () => services?.find((s) => s.id === serviceId) ?? null,
    [services, serviceId],
  )

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
    if (!slug || !serviceId) return

    async function loadAvailability() {
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
    }
    void loadAvailability()
  }, [slug, serviceId, selectedProvider])

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
            Pick a service and time. We'll hold it while you confirm.
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

                {selectedService && (
                  <p className="text-sm text-muted-foreground">
                    {selectedService.durationMinutes} minutes ·{' '}
                    {formatPrice(selectedService.price)}
                  </p>
                )}
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
                    No upcoming times for this service right now — join the
                    waitlist below to be notified.
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
                            key={`${bucket.providerId}-${bucket.datetime}`}
                            type="button"
                            onClick={() => setWaitlistOpenFor(bucket)}
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

                <Alert>
                  <span className="flex items-start gap-2">
                    <Clock className="mt-0.5 size-4 shrink-0" />
                    Online self-checkout isn't live yet — pick a time to join
                    the waitlist and we'll email you the moment it's
                    confirmable, or contact the business directly to book.
                  </span>
                </Alert>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {waitlistOpenFor && business && (
        <WaitlistDialog
          businessId={business.id}
          bucket={waitlistOpenFor}
          onClose={() => setWaitlistOpenFor(null)}
        />
      )}
    </div>
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
      })}`}
      footer={
        done ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="waitlist-form"
              disabled={submitting}
            >
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
