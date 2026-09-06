import { useEffect, useMemo, useState } from 'react'
import {
  CalendarX2,
  ChevronDown,
  ClipboardList,
  Sparkles,
} from 'lucide-react'

import type { Service, Slot } from '@queueless/shared-types'

import { apiFetch, ApiRequestError } from '@/lib/api'
import { useSlotUpdates } from '@/lib/realtime'
import { cn } from '@/lib/utils'
import {
  bookingStatusBadge,
  formatDateTime,
  groupByDay,
} from '@/lib/format'
import { PageHeader } from '@/components/layout/page-header'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { SkeletonList } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'

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

interface Row {
  booking: BookingListItem
  slot: Slot | null
  provider: Provider | null
  serviceName: string | null
}

/**
 * Staff/owner dashboard — every booking for the business, with the full
 * Phase 4 action set: cancel, reschedule (atomic two-slot swap), and
 * mark completed / no-show. `GET /api/bookings` only stores a slotId, so
 * slots + providers + services are fetched once and joined client-side.
 * "Live" via the shared slot-update socket — a matching event refetches,
 * since only slot-level realtime events are in the locked payload.
 */
export function StaffBookingsPage() {
  const [bookings, setBookings] = useState<BookingListItem[] | null>(null)
  const [slotsById, setSlotsById] = useState<Map<string, Slot>>(new Map())
  const [providersById, setProvidersById] = useState<Map<string, Provider>>(
    new Map(),
  )
  const [serviceNames, setServiceNames] = useState<Map<string, string>>(
    new Map(),
  )
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [rescheduleFor, setRescheduleFor] = useState<Row | null>(null)
  const [cancelFor, setCancelFor] = useState<Row | null>(null)
  // Snapshot of "now" for the upcoming/past split — refreshed on every
  // load (mount + socket-triggered refetch), never read during render.
  const [now, setNow] = useState<number>(() => Date.now())

  async function load() {
    setNow(Date.now())
    try {
      const [bookingsData, slotsData, providersData, servicesData] =
        await Promise.all([
          apiFetch<BookingListItem[]>('/bookings'),
          apiFetch<Slot[]>('/slots'),
          apiFetch<Provider[]>('/providers'),
          apiFetch<Service[]>('/services'),
        ])
      setBookings(bookingsData)
      setSlotsById(new Map(slotsData.map((s) => [s.id, s])))
      setProvidersById(
        new Map(
          providersData.map((p) => [`${p.providerType}:${p.providerId}`, p]),
        ),
      )
      setServiceNames(new Map(servicesData.map((s) => [s.id, s.name])))
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

  const { upcoming, past } = useMemo(() => {
    const rows: Row[] = (bookings ?? []).map((booking) => {
      const slot = slotsById.get(booking.slotId) ?? null
      const provider = slot
        ? providersById.get(`${slot.providerType}:${slot.providerId}`) ?? null
        : null
      const serviceName = slot
        ? serviceNames.get(slot.serviceId) ?? null
        : null
      return { booking, slot, provider, serviceName }
    })

    const isUpcoming = (r: Row) =>
      r.booking.status === 'confirmed' &&
      r.slot != null &&
      new Date(r.slot.datetime).getTime() >= now

    return {
      upcoming: rows
        .filter(isUpcoming)
        .sort(
          (a, b) =>
            new Date(a.slot!.datetime).getTime() -
            new Date(b.slot!.datetime).getTime(),
        ),
      past: rows
        .filter((r) => !isUpcoming(r))
        .sort(
          (a, b) =>
            new Date(b.slot?.datetime ?? b.booking.createdAt).getTime() -
            new Date(a.slot?.datetime ?? a.booking.createdAt).getTime(),
        ),
    }
  }, [bookings, slotsById, providersById, serviceNames, now])

  async function markOutcome(row: Row, status: 'completed' | 'no-show') {
    try {
      await apiFetch(`/bookings/${row.booking.id}/outcome`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      })
      await load()
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not update the booking.',
      )
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bookings"
        description="Everything booked for this business. Live — updates as slots change."
      />

      {error && <Alert variant="destructive">{error}</Alert>}

      {bookings === null && !error && <SkeletonList rows={4} />}

      {bookings && bookings.length === 0 && (
        <EmptyState
          icon={ClipboardList}
          title="No bookings yet"
          description="Bookings from your public page and walk-ins entered by staff will show up here."
        />
      )}

      {bookings && bookings.length > 0 && (
        <div className="space-y-8">
          <Section
            title="Upcoming"
            count={upcoming.length}
            rows={upcoming}
            expandedId={expandedId}
            onToggle={setExpandedId}
            onReschedule={setRescheduleFor}
            onCancel={setCancelFor}
            onOutcome={markOutcome}
            emptyLabel="No upcoming bookings."
          />
          <Section
            title="Past & closed"
            count={past.length}
            rows={past}
            expandedId={expandedId}
            onToggle={setExpandedId}
            onReschedule={setRescheduleFor}
            onCancel={setCancelFor}
            onOutcome={markOutcome}
            emptyLabel="Nothing here yet."
          />
        </div>
      )}

      <RescheduleDialog
        row={rescheduleFor}
        onClose={() => setRescheduleFor(null)}
        onDone={async () => {
          setRescheduleFor(null)
          await load()
        }}
      />

      <CancelDialog
        row={cancelFor}
        onClose={() => setCancelFor(null)}
        onDone={async () => {
          setCancelFor(null)
          await load()
        }}
      />
    </div>
  )
}

function Section({
  title,
  count,
  rows,
  expandedId,
  onToggle,
  onReschedule,
  onCancel,
  onOutcome,
  emptyLabel,
}: {
  title: string
  count: number
  rows: Row[]
  expandedId: string | null
  onToggle: (id: string | null) => void
  onReschedule: (row: Row) => void
  onCancel: (row: Row) => void
  onOutcome: (row: Row, status: 'completed' | 'no-show') => void
  emptyLabel: string
}) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        {title}
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {count}
        </span>
      </h2>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="space-y-4">
          {groupByDay(
            rows.map((r) => ({
              ...r,
              datetime: r.slot?.datetime ?? r.booking.createdAt,
            })),
          ).map((group) => (
            <div key={group.key}>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {group.label}
              </p>
              <Card>
                <CardContent className="divide-y divide-border p-0">
                  {group.items.map((row) => (
                    <BookingRow
                      key={row.booking.id}
                      row={row}
                      expanded={expandedId === row.booking.id}
                      onToggle={() =>
                        onToggle(
                          expandedId === row.booking.id
                            ? null
                            : row.booking.id,
                        )
                      }
                      onReschedule={() => onReschedule(row)}
                      onCancel={() => onCancel(row)}
                      onOutcome={(status) => onOutcome(row, status)}
                    />
                  ))}
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function BookingRow({
  row,
  expanded,
  onToggle,
  onReschedule,
  onCancel,
  onOutcome,
}: {
  row: Row
  expanded: boolean
  onToggle: () => void
  onReschedule: () => void
  onCancel: () => void
  onOutcome: (status: 'completed' | 'no-show') => void
}) {
  const { booking, slot, provider, serviceName } = row
  const [busy, setBusy] = useState<null | 'completed' | 'no-show'>(null)
  const canAct = booking.status === 'confirmed'

  async function handleOutcome(status: 'completed' | 'no-show') {
    setBusy(status)
    try {
      await onOutcome(status)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/40"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {slot ? formatDateTime(slot.datetime) : 'Time unknown'}
            </span>
            <Badge variant={bookingStatusBadge[booking.status]}>
              {booking.status}
            </Badge>
            {booking.createdBy && <Badge variant="secondary">Walk-in</Badge>}
            {booking.noShowRiskNote && (
              <Badge variant="warning">
                <Sparkles className="size-3" /> Risk note
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {serviceName ? `${serviceName} · ` : ''}
            {provider?.name ?? 'Provider'} · {booking.customer.name}
          </p>
        </div>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-border bg-secondary/20 px-4 py-4">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Detail label="Customer" value={booking.customer.name} />
            <Detail
              label={booking.customer.contactType === 'email' ? 'Email' : 'Phone'}
              value={booking.customer.contact}
            />
            <Detail label="Service" value={serviceName ?? '—'} />
            <Detail
              label="Provider"
              value={
                provider
                  ? `${provider.name} (${provider.providerType})`
                  : '—'
              }
            />
            <Detail
              label="Booked"
              value={formatDateTime(booking.createdAt)}
            />
            <Detail
              label="Source"
              value={booking.createdBy ? 'Staff walk-in' : 'Customer self-service'}
            />
          </dl>

          {booking.noShowRiskNote && (
            <Alert variant="warning">
              <span className="flex items-start gap-2">
                <Sparkles className="mt-0.5 size-4 shrink-0" />
                <span>
                  <span className="font-medium">No-show risk: </span>
                  {booking.noShowRiskNote}
                </span>
              </span>
            </Alert>
          )}

          {canAct ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={onReschedule}>
                Reschedule
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => handleOutcome('completed')}
              >
                {busy === 'completed' && <Spinner />}
                Mark completed
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => handleOutcome('no-show')}
              >
                {busy === 'no-show' && <Spinner />}
                Mark no-show
              </Button>
              <Button size="sm" variant="destructive" onClick={onCancel}>
                Cancel booking
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              This booking is {booking.status} — no further actions.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}

function RescheduleDialog({
  row,
  onClose,
  onDone,
}: {
  row: Row | null
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [slotsError, setSlotsError] = useState<string | null>(null)
  const [datetime, setDatetime] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const slot = row?.slot ?? null

  useEffect(() => {
    if (!row || !slot) return

    async function loadSlots(current: Slot) {
      setSlots(null)
      setDatetime('')
      setError(null)
      setSlotsError(null)
      try {
        const params = new URLSearchParams({
          status: 'available',
          providerId: current.providerId,
          providerType: current.providerType,
          serviceId: current.serviceId,
        })
        const data = await apiFetch<Slot[]>(`/slots?${params.toString()}`)
        setSlots(
          data
            .filter((s) => s.id !== current.id)
            .sort(
              (a, b) =>
                new Date(a.datetime).getTime() -
                new Date(b.datetime).getTime(),
            ),
        )
      } catch (err) {
        setSlotsError(
          err instanceof ApiRequestError
            ? err.message
            : 'Could not load available times.',
        )
      }
    }
    void loadSlots(slot)
  }, [row, slot])

  async function handleConfirm() {
    if (!row || !slot || !datetime) return
    setSubmitting(true)
    setError(null)
    try {
      await apiFetch(`/bookings/${row.booking.id}/reschedule`, {
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
          : 'Could not reschedule the booking.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={row !== null}
      onClose={onClose}
      title="Reschedule booking"
      description={
        slot
          ? `Currently ${formatDateTime(slot.datetime)} — same provider and service.`
          : undefined
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Keep current time
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={submitting || !datetime}
          >
            {submitting && <Spinner />}
            Confirm swap
          </Button>
        </>
      }
    >
      {error && (
        <Alert variant="destructive" className="mb-4">
          {error}
        </Alert>
      )}
      {slotsError && (
        <Alert variant="destructive" className="mb-4">
          {slotsError}
        </Alert>
      )}

      {slots === null && !slotsError && (
        <p className="text-sm text-muted-foreground">Loading available times…</p>
      )}

      {slots && slots.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No other open times for this provider and service. Generate more
          slots or free one up on the Schedule page first.
        </p>
      )}

      {slots && slots.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="reschedule-time">New time</Label>
          <Select
            id="reschedule-time"
            value={datetime}
            onChange={(e) => setDatetime(e.target.value)}
          >
            <option value="" disabled>
              Select a time
            </option>
            {slots.map((s) => (
              <option key={s.id} value={s.datetime}>
                {formatDateTime(s.datetime)}
              </option>
            ))}
          </Select>
        </div>
      )}
    </Dialog>
  )
}

function CancelDialog({
  row,
  onClose,
  onDone,
}: {
  row: Row | null
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    if (!row) return
    setSubmitting(true)
    setError(null)
    try {
      await apiFetch(`/bookings/${row.booking.id}/cancel`, { method: 'POST' })
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
      open={row !== null}
      onClose={onClose}
      title="Cancel this booking?"
      description="The slot is released and the next person on the waitlist is notified. This can't be undone."
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
      {row && (
        <div className="flex items-center gap-3 rounded-md border border-border bg-secondary/30 px-4 py-3 text-sm">
          <CalendarX2 className="size-4 shrink-0 text-muted-foreground" />
          <span>
            {row.slot ? formatDateTime(row.slot.datetime) : 'Time unknown'} ·{' '}
            {row.booking.customer.name}
          </span>
        </div>
      )}
    </Dialog>
  )
}
