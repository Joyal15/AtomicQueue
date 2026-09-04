import { useEffect, useMemo, useState, type FormEvent } from 'react'

import type { Service, Slot } from '@queueless/shared-types'

import { apiFetch, ApiRequestError } from '@/lib/api'
import { Alert } from '@/components/ui/alert'
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

/** Not published to shared-types yet — see SchedulePage.tsx. */
interface Provider {
  providerId: string
  providerType: 'staff' | 'resource'
  businessId: string
  name: string
  status: 'active' | 'removed'
  capacity: number
  role: 'owner' | 'staff' | null
}

interface CreatedBooking {
  bookingId: string
  accessToken: string
}

function providerKey(providerId: string, providerType: string): string {
  return `${providerType}:${providerId}`
}

/**
 * Staff/owner creates a booking directly on a customer's behalf — no
 * hold step from the UI's point of view (POST /api/bookings does the
 * claim-hold-confirm sequence server-side in one call).
 */
export function WalkInBookingPage() {
  const [services, setServices] = useState<Service[] | null>(null)
  const [providers, setProviders] = useState<Provider[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [serviceId, setServiceId] = useState('')
  const [providerKeyValue, setProviderKeyValue] = useState('')

  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [slotsError, setSlotsError] = useState<string | null>(null)
  const [datetime, setDatetime] = useState('')

  const [customerName, setCustomerName] = useState('')
  const [contactType, setContactType] = useState<'email' | 'phone'>('email')
  const [contact, setContact] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedBooking | null>(null)

  const selectedProvider = useMemo(
    () =>
      providers?.find(
        (p) => providerKey(p.providerId, p.providerType) === providerKeyValue,
      ) ?? null,
    [providers, providerKeyValue],
  )

  useEffect(() => {
    async function load() {
      try {
        const [servicesData, providersData] = await Promise.all([
          apiFetch<Service[]>('/services'),
          apiFetch<Provider[]>('/providers'),
        ])
        const active = servicesData.filter((s) => s.isActive)
        setServices(active)
        setProviders(providersData)
        if (active.length > 0) setServiceId(active[0].id)
        if (providersData.length > 0) {
          setProviderKeyValue(
            providerKey(providersData[0].providerId, providersData[0].providerType),
          )
        }
        setLoadError(null)
      } catch (err) {
        setLoadError(
          err instanceof ApiRequestError
            ? err.message
            : 'Could not load services/providers.',
        )
      }
    }
    void load()
  }, [])

  useEffect(() => {
    async function loadSlots() {
      if (!selectedProvider || !serviceId) {
        setSlots(null)
        return
      }
      setSlots(null)
      setDatetime('')
      try {
        const data = await apiFetch<Slot[]>(
          `/slots?status=available&providerId=${encodeURIComponent(selectedProvider.providerId)}&providerType=${selectedProvider.providerType}&serviceId=${encodeURIComponent(serviceId)}`,
        )
        setSlots(data)
        setSlotsError(null)
      } catch (err) {
        setSlotsError(
          err instanceof ApiRequestError
            ? err.message
            : 'Could not load available times.',
        )
      }
    }
    void loadSlots()
  }, [selectedProvider, serviceId])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setFormError(null)
    setCreated(null)

    if (!selectedProvider || !datetime) {
      setFormError('Pick a provider and a time first.')
      setSubmitting(false)
      return
    }

    try {
      const result = await apiFetch<CreatedBooking>('/bookings', {
        method: 'POST',
        body: JSON.stringify({
          providerId: selectedProvider.providerId,
          providerType: selectedProvider.providerType,
          serviceId,
          datetime,
          customer: {
            name: customerName,
            contactType,
            contact,
          },
        }),
      })
      setCreated(result)
      setCustomerName('')
      setContact('')
      // That slot is gone — drop it from the list rather than refetch.
      setSlots((current) => current?.filter((s) => s.datetime !== datetime) ?? current)
      setDatetime('')
    } catch (err) {
      setFormError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not create the booking.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Book for a walk-in customer</CardTitle>
          <CardDescription>
            Confirms immediately — no hold step, no email required.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadError && <Alert variant="destructive">{loadError}</Alert>}

          {services?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No active services yet — add one under Services first.
            </p>
          )}
          {providers?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No providers yet — add a staff member or a resource first.
            </p>
          )}

          {services && services.length > 0 && providers && providers.length > 0 && (
            <form className="space-y-4" onSubmit={handleSubmit}>
              {formError && <Alert variant="destructive">{formError}</Alert>}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="walkin-service">Service</Label>
                  <select
                    id="walkin-service"
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
                  <Label htmlFor="walkin-provider">Provider</Label>
                  <select
                    id="walkin-provider"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={providerKeyValue}
                    onChange={(e) => setProviderKeyValue(e.target.value)}
                  >
                    {providers.map((p) => (
                      <option
                        key={providerKey(p.providerId, p.providerType)}
                        value={providerKey(p.providerId, p.providerType)}
                      >
                        {p.name} ({p.providerType})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="walkin-time">Available time</Label>
                {slotsError && <Alert variant="destructive">{slotsError}</Alert>}
                {slots === null && !slotsError && (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                )}
                {slots?.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No available times for this provider/service — generate
                    or free up a slot on the Schedule page first.
                  </p>
                )}
                {slots && slots.length > 0 && (
                  <select
                    id="walkin-time"
                    required
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={datetime}
                    onChange={(e) => setDatetime(e.target.value)}
                  >
                    <option value="" disabled>
                      Select a time
                    </option>
                    {slots.map((slot) => (
                      <option key={slot.id} value={slot.datetime}>
                        {new Date(slot.datetime).toLocaleString()}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="walkin-name">Customer name</Label>
                  <Input
                    id="walkin-name"
                    required
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="walkin-contact-type">Contact type</Label>
                  <select
                    id="walkin-contact-type"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={contactType}
                    onChange={(e) =>
                      setContactType(e.target.value as 'email' | 'phone')
                    }
                  >
                    <option value="email">Email</option>
                    <option value="phone">Phone</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="walkin-contact">
                    {contactType === 'email' ? 'Email' : 'Phone'}
                  </Label>
                  <Input
                    id="walkin-contact"
                    required
                    type={contactType === 'email' ? 'email' : 'tel'}
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                  />
                </div>
              </div>

              <Button type="submit" disabled={submitting || !datetime}>
                {submitting ? 'Booking…' : 'Confirm booking'}
              </Button>
            </form>
          )}

          {created && (
            <Alert className="mt-4">
              Booked. No email delivery yet, so if this customer wants
              self-service manage access later, share this access token
              manually:
              <br />
              <code className="mt-1 block break-all rounded bg-secondary px-2 py-1 text-xs">
                {created.accessToken}
              </code>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
