import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowUpRight,
  CalendarCheck2,
  CalendarClock,
  Scissors,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type { Service } from '@queueless/shared-types'

import { apiFetch, ApiRequestError } from '@/lib/api'
import { useAuth } from '@/lib/use-auth'
import { PageHeader } from '@/components/layout/page-header'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'

interface BookingListItem {
  id: string
  status: 'confirmed' | 'cancelled' | 'completed' | 'no-show'
  slotId: string
}

interface SlotListItem {
  id: string
  datetime: string
}

interface ProviderListItem {
  status: 'active' | 'removed'
}

interface Stats {
  todayCount: number
  upcomingCount: number
  activeServices: number
  teamSize: number
}

/**
 * Business settings — GET/PATCH /api/tenants. Viewable by owner or
 * staff, editable by owner only (enforced server-side; staff just don't
 * see the edit form here). Also the dashboard landing page, so it opens
 * with an at-a-glance summary built from the same read endpoints the
 * other tabs already use — no new API surface.
 */
export function DashboardOverviewPage() {
  const { business, user, refreshBusiness } = useAuth()
  const isOwner = user?.role === 'owner'

  const [stats, setStats] = useState<Stats | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)

  useEffect(() => {
    async function loadStats() {
      try {
        const [bookings, slots, services, providers] = await Promise.all([
          apiFetch<BookingListItem[]>('/bookings'),
          apiFetch<SlotListItem[]>('/slots'),
          apiFetch<Service[]>('/services'),
          apiFetch<ProviderListItem[]>('/providers'),
        ])
        const slotTimeById = new Map(slots.map((s) => [s.id, s.datetime]))
        const now = Date.now()
        const startOfDay = new Date()
        startOfDay.setHours(0, 0, 0, 0)
        const endOfDay = new Date(startOfDay)
        endOfDay.setDate(endOfDay.getDate() + 1)

        let todayCount = 0
        let upcomingCount = 0
        for (const b of bookings) {
          if (b.status !== 'confirmed') continue
          const iso = slotTimeById.get(b.slotId)
          if (!iso) continue
          const t = new Date(iso).getTime()
          if (t < now) continue
          upcomingCount += 1
          if (t < endOfDay.getTime()) todayCount += 1
        }

        setStats({
          todayCount,
          upcomingCount,
          activeServices: services.filter((s) => s.isActive).length,
          teamSize: providers.filter((p) => p.status === 'active').length,
        })
        setStatsError(null)
      } catch (err) {
        setStatsError(
          err instanceof ApiRequestError
            ? err.message
            : 'Could not load your business summary.',
        )
      }
    }
    void loadStats()
  }, [])

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Welcome back${user ? `, ${user.name.split(' ')[0]}` : ''}`}
        description={
          business
            ? `Here's what's happening at ${business.name}.`
            : 'Loading your business…'
        }
        actions={
          business ? (
            <Button asChild variant="outline" size="sm">
              <Link to={`/b/${business.slug}`} target="_blank" rel="noreferrer">
                View public page
                <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          ) : undefined
        }
      />

      {statsError && <Alert variant="destructive">{statsError}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={CalendarCheck2}
          label="Booked today"
          value={stats?.todayCount}
        />
        <StatCard
          icon={CalendarClock}
          label="Upcoming"
          value={stats?.upcomingCount}
        />
        <StatCard
          icon={Scissors}
          label="Active services"
          value={stats?.activeServices}
        />
        <StatCard icon={Users} label="Team" value={stats?.teamSize} />
      </div>

      <BusinessSettingsCard
        business={business}
        isOwner={isOwner}
        onSaved={refreshBusiness}
      />
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: number | undefined
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 py-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          {value === undefined ? (
            <Skeleton className="h-7 w-10" />
          ) : (
            <p className="text-2xl font-semibold leading-tight tabular-nums">
              {value}
            </p>
          )}
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function BusinessSettingsCard({
  business,
  isOwner,
  onSaved,
}: {
  business: ReturnType<typeof useAuth>['business']
  isOwner: boolean
  onSaved: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(business?.name ?? '')
  const [timezone, setTimezone] = useState(business?.timezone ?? '')
  const [cutoff, setCutoff] = useState(
    business?.cancellationCutoffMinutes ?? 60,
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function startEditing() {
    setName(business?.name ?? '')
    setTimezone(business?.timezone ?? '')
    setCutoff(business?.cancellationCutoffMinutes ?? 60)
    setError(null)
    setEditing(true)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      await apiFetch('/tenants', {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          timezone,
          cancellationCutoffMinutes: Number(cutoff),
        }),
      })
      await onSaved()
      setEditing(false)
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : 'Something went wrong. Please try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Business settings</CardTitle>
        {isOwner && business && !editing && (
          <Button variant="outline" size="sm" onClick={startEditing}>
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!business ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-64" />
          </div>
        ) : !editing ? (
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            <Item label="Name" value={business.name} />
            <Item label="Public link" value={`/b/${business.slug}`} mono />
            <Item label="Timezone" value={business.timezone} />
            <Item
              label="Cancellation cutoff"
              value={`${business.cancellationCutoffMinutes} minutes before start`}
            />
          </dl>
        ) : (
          <form className="max-w-md space-y-4" onSubmit={handleSubmit}>
            {error && <Alert variant="destructive">{error}</Alert>}

            <div className="space-y-2">
              <Label htmlFor="biz-name">Name</Label>
              <Input
                id="biz-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="biz-timezone">Timezone (IANA)</Label>
              <Input
                id="biz-timezone"
                required
                placeholder="Asia/Kolkata"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="biz-cutoff">Cancellation cutoff (minutes)</Label>
              <Input
                id="biz-cutoff"
                type="number"
                min={0}
                required
                value={cutoff}
                onChange={(e) => setCutoff(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                How close to the start time a customer can still reschedule or
                cancel their own booking.
              </p>
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting && <Spinner />}
                Save changes
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

function Item({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono text-[0.8125rem]' : 'font-medium'}>
        {value}
      </dd>
    </div>
  )
}
