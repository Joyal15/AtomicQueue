import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'

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

/**
 * None of these are published to shared-types yet — they're the public,
 * name-bearing projections the backend's publicCatalog/publicAvailability
 * endpoints return (deliberately different shape from the authenticated
 * Service/Provider/Slot types, since those carry internal-only fields
 * like isActive/status/role a customer has no business seeing).
 */
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
 * Public, unauthenticated booking page — `/b/:slug`. Browsing (service
 * pick → provider pick → live availability grid) is fully real, backed
 * by the public catalog/availability endpoints. What it deliberately
 * does NOT do: let a customer actually claim/confirm a slot — there is
 * no anonymous booking endpoint on the backend yet (only staff/owner
 * sessions can create a booking today), so this shows that honestly
 * rather than a submit button that goes nowhere. Joining the waitlist
 * is real and works today, so that's the one action offered per slot.
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
  // Tracks which (serviceId, provider) combo `buckets` currently
  // belongs to, so switching either clears stale results immediately
  // (render-time reset below) instead of briefly showing them.
  const [loadedAvailabilityKey, setLoadedAvailabilityKey] = useState<
    string | null
  >(null)

  const [waitlistOpenFor, setWaitlistOpenFor] = useState<AvailabilityBucket | null>(
    null,
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
        setBuckets(data)
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
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <p className="text-lg font-medium">Business not found</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Double-check the link — this booking page doesn't exist.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          QueueLess++
        </p>
        <h1 className="text-2xl font-semibold">
          {business ? business.name : 'Book an appointment'}
        </h1>
      </div>

      {businessError && <Alert variant="destructive">{businessError}</Alert>}

      {!services && !businessError && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {services && services.length === 0 && (
        <p className="text-sm text-muted-foreground">
          This business hasn't set up any bookable services yet.
        </p>
      )}

      {services && services.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Choose a service</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="public-service">Service</Label>
                <select
                  id="public-service"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={serviceId}
                  onChange={(e) => setServiceId(e.target.value)}
                >
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.durationMinutes} min)
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="public-provider">Provider</Label>
                <select
                  id="public-provider"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
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
                </select>
              </div>
            </div>

            {bucketsError && <Alert variant="destructive">{bucketsError}</Alert>}

            {buckets === null && !bucketsError && (
              <p className="text-sm text-muted-foreground">Loading times…</p>
            )}

            {buckets?.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No upcoming times for this service right now.
              </p>
            )}

            {buckets && buckets.length > 0 && (
              <div className="space-y-2">
                {buckets.map((bucket) => {
                  const provider = providers?.find(
                    (p) =>
                      p.providerId === bucket.providerId &&
                      p.providerType === bucket.providerType,
                  )
                  const full = bucket.remaining === 0

                  return (
                    <div
                      key={`${bucket.providerId}-${bucket.datetime}`}
                      className="flex items-center justify-between rounded-md border border-border px-4 py-3"
                    >
                      <div>
                        <p className="font-medium">
                          {new Date(bucket.datetime).toLocaleString()}
                        </p>
                        <div className="text-sm text-muted-foreground">
                          {provider?.name ?? 'Provider'} ·{' '}
                          {bucket.total > 1 ? (
                            <Badge variant={full ? 'destructive' : 'default'}>
                              {bucket.remaining} of {bucket.total} left
                            </Badge>
                          ) : full ? (
                            <Badge variant="destructive">Taken</Badge>
                          ) : (
                            <Badge variant="default">Available</Badge>
                          )}
                        </div>
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setWaitlistOpenFor(bucket)}
                      >
                        {full ? 'Join waitlist' : 'Notify me'}
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}

            <Alert>
              Online self-checkout isn't live yet — join the waitlist for a
              time above and we'll email you the moment it opens up, or
              contact the business directly to book.
            </Alert>
          </CardContent>
        </Card>
      )}

      {waitlistOpenFor && business && (
        <WaitlistJoinCard
          businessId={business.id}
          bucket={waitlistOpenFor}
          onClose={() => setWaitlistOpenFor(null)}
        />
      )}
    </div>
  )
}

function WaitlistJoinCard({
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
    <Card>
      <CardHeader>
        <CardTitle>Get notified</CardTitle>
        <CardDescription>
          {new Date(bucket.datetime).toLocaleString()}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {done ? (
          <Alert>You're on the list — we'll email you if this opens up.</Alert>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit}>
            {error && <Alert variant="destructive">{error}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
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
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Joining…' : 'Join waitlist'}
              </Button>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
