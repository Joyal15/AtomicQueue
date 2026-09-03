import { useState, type FormEvent } from 'react'

import { apiFetch, ApiRequestError } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
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

/**
 * Business settings — GET/PATCH /api/tenants. Viewable by owner or
 * staff (architecture doc Section 9's business-wide-visibility rule);
 * editable by owner only, enforced server-side and mirrored here so
 * staff simply don't see the edit form.
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

  if (!business) {
    return (
      <p className="text-sm text-muted-foreground">Loading business…</p>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Business settings</CardTitle>
        <CardDescription>
          {business.slug} · {business.timezone}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!editing ? (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground">Name</dt>
                <dd className="font-medium">{business.name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Timezone</dt>
                <dd className="font-medium">{business.timezone}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  Cancellation cutoff
                </dt>
                <dd className="font-medium">
                  {business.cancellationCutoffMinutes} minutes
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Slug</dt>
                <dd className="font-medium">{business.slug}</dd>
              </div>
            </dl>

            {isOwner && (
              <Button variant="outline" size="sm" onClick={startEditing}>
                Edit settings
              </Button>
            )}
          </div>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit}>
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
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Saving…' : 'Save changes'}
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
