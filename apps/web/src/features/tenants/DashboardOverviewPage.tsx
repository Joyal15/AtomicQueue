import { useState, type FormEvent } from 'react'

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

/**
 * Business settings — GET/PATCH /api/tenants. Viewable by owner or
 * staff, editable by owner only (enforced server-side; staff just don't
 * see the edit form here).
 */
export function DashboardOverviewPage() {
  const { business, user, refreshBusiness } = useAuth()
  const isOwner = user?.role === 'owner'

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
      await refreshBusiness()
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
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description="Your business profile and booking policy."
        actions={
          isOwner && business && !editing ? (
            <Button variant="outline" size="sm" onClick={startEditing}>
              Edit settings
            </Button>
          ) : undefined
        }
      />

      {!business ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-64" />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Business settings</CardTitle>
          </CardHeader>
          <CardContent>
            {!editing ? (
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
                  <Label htmlFor="biz-cutoff">
                    Cancellation cutoff (minutes)
                  </Label>
                  <Input
                    id="biz-cutoff"
                    type="number"
                    min={0}
                    required
                    value={cutoff}
                    onChange={(e) => setCutoff(Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">
                    How close to the start time a customer can still
                    reschedule or cancel their own booking.
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
      )}
    </div>
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
