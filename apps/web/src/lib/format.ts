/** Shared display formatters + status → Badge-variant maps. */

type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'success'
  | 'warning'
  | 'outline'

const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
})

const dayKeyFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'short',
  day: 'numeric',
})

export function formatDateTime(iso: string | Date): string {
  return dateTimeFmt.format(new Date(iso))
}

export function formatDate(iso: string | Date): string {
  return dateFmt.format(new Date(iso))
}

export function formatTime(iso: string | Date): string {
  return timeFmt.format(new Date(iso))
}

/** Groups a list of things carrying a `datetime` into day sections. */
export function groupByDay<T extends { datetime: string }>(
  items: T[],
): { key: string; label: string; items: T[] }[] {
  const groups = new Map<string, { label: string; items: T[] }>()

  for (const item of items) {
    const d = new Date(item.datetime)
    // Local-date key so it always matches the local-formatted label.
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
    const existing = groups.get(key)
    if (existing) {
      existing.items.push(item)
    } else {
      groups.set(key, { label: dayKeyFmt.format(d), items: [item] })
    }
  }

  return [...groups.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort(
      (a, b) =>
        new Date(a.items[0].datetime).getTime() -
        new Date(b.items[0].datetime).getTime(),
    )
}

export function formatPrice(value: number): string {
  if (!value) return 'Free'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value)
}

export const bookingStatusBadge: Record<
  'confirmed' | 'cancelled' | 'completed' | 'no-show',
  BadgeVariant
> = {
  confirmed: 'success',
  completed: 'secondary',
  cancelled: 'destructive',
  'no-show': 'warning',
}

export const slotStatusBadge: Record<
  'available' | 'held' | 'confirmed' | 'cancelled' | 'blocked',
  BadgeVariant
> = {
  available: 'success',
  held: 'warning',
  confirmed: 'default',
  cancelled: 'secondary',
  blocked: 'destructive',
}

export const waitlistStatusBadge: Record<
  'waiting' | 'notified' | 'expired' | 'converted',
  BadgeVariant
> = {
  waiting: 'secondary',
  notified: 'default',
  expired: 'destructive',
  converted: 'success',
}

export const invitationStatusBadge: Record<
  'pending' | 'accepted' | 'revoked' | 'expired',
  BadgeVariant
> = {
  pending: 'default',
  accepted: 'success',
  revoked: 'destructive',
  expired: 'secondary',
}
