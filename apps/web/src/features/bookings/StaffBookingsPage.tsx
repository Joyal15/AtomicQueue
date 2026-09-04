import { useEffect, useMemo, useState } from 'react'

import type { Slot } from '@queueless/shared-types'

import { apiFetch, ApiRequestError } from '@/lib/api'
import { useSlotUpdates } from '@/lib/realtime'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface BookingListItem {
  id: string
  businessId: string
  slotId: string
  customer: { name: string; contactType: 'email' | 'phone'; contact: string }
  createdBy: string | null
  status: 'confirmed' | 'cancelled' | 'completed' | 'no-show'
  accessTokenExpiresAt: string | null
  noShowRiskNote: string | null
  createdAt: string
  cancelledAt: string | null
}

/** Not published to shared-types yet — see SchedulePage.tsx. */
interface Provider {
  providerId: string
  providerType: 'staff' | 'resource'
  name: string
}

const badgeVariantByStatus: Record<
  BookingListItem['status'],
  'default' | 'secondary' | 'destructive'
> = {
  confirmed: 'default',
  completed: 'secondary',
  cancelled: 'destructive',
  'no-show': 'destructive',
}

/**
 * Staff/owner dashboard — every booking for the business. `GET
 * /api/bookings` doesn't return slot/provider details (Booking only
 * stores slotId), so this fetches the business's slots once and joins
 * client-side to show a real date/provider instead of a raw slotId.
 * "Live" via the same slot-update socket the Schedule page uses: a
 * matching event just triggers a refetch, since booking-level realtime
 * events aren't part of the locked payload contract, only slot ones.
 */
export function StaffBookingsPage() {
  const [bookings, setBookings] = useState<BookingListItem[] | null>(null)
  const [slotsById, setSlotsById] = useState<Map<string, Slot>>(new Map())
  const [providersById, setProvidersById] = useState<Map<string, Provider>>(
    new Map(),
  )
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const [bookingsData, slotsData, providersData] = await Promise.all([
        apiFetch<BookingListItem[]>('/bookings'),
        apiFetch<Slot[]>('/slots'),
        apiFetch<Provider[]>('/providers'),
      ])
      setBookings(bookingsData)
      setSlotsById(new Map(slotsData.map((s) => [s.id, s])))
      setProvidersById(
        new Map(
          providersData.map((p) => [`${p.providerType}:${p.providerId}`, p]),
        ),
      )
      setError(null)
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not load bookings.',
      )
    }
  }

  useEffect(() => {
    async function run() {
      await load()
    }
    void run()
  }, [])

  useSlotUpdates(() => {
    void load()
  })

  const rows = useMemo(() => {
    if (!bookings) return null
    return bookings.map((booking) => {
      const slot = slotsById.get(booking.slotId) ?? null
      const provider = slot
        ? providersById.get(`${slot.providerType}:${slot.providerId}`)
        : null
      return { booking, slot, provider }
    })
  }, [bookings, slotsById, providersById])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bookings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <Alert variant="destructive">{error}</Alert>}

        {rows === null && !error && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}

        {rows?.length === 0 && (
          <p className="text-sm text-muted-foreground">No bookings yet.</p>
        )}

        {rows && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map(({ booking, slot, provider }) => (
              <div
                key={booking.id}
                className="flex items-center justify-between rounded-md border border-border px-4 py-3"
              >
                <div>
                  <div className="font-medium">
                    {slot ? new Date(slot.datetime).toLocaleString() : '—'}{' '}
                    <Badge variant={badgeVariantByStatus[booking.status]}>
                      {booking.status}
                    </Badge>
                    {booking.createdBy && (
                      <Badge variant="secondary">Walk-in</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {provider?.name ?? 'Provider'} · {booking.customer.name} (
                    {booking.customer.contact})
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
