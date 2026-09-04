import { useEffect, useState } from 'react'

import { apiFetch, ApiRequestError } from '@/lib/api'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface WaitlistEntry {
  id: string
  businessId: string
  customer: { name: string; contact: string }
  desiredServiceId: string
  desiredProviderId: string | null
  status: 'waiting' | 'notified' | 'expired' | 'converted'
  createdAt: string
}

const badgeVariantByStatus: Record<
  WaitlistEntry['status'],
  'default' | 'secondary' | 'destructive'
> = {
  waiting: 'secondary',
  notified: 'default',
  expired: 'destructive',
  converted: 'default',
}

/**
 * Staff/owner view of who's waiting for a slot to open up. Read-only —
 * matching happens automatically server-side (Slots' lazy-release
 * path triggers it), nothing for staff to action here yet.
 */
export function StaffWaitlistPage() {
  const [entries, setEntries] = useState<WaitlistEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const data = await apiFetch<WaitlistEntry[]>('/waitlist')
        setEntries(data)
        setError(null)
      } catch (err) {
        setError(
          err instanceof ApiRequestError
            ? err.message
            : 'Could not load the waitlist.',
        )
      }
    }
    void load()
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Waitlist</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <Alert variant="destructive">{error}</Alert>}

        {entries === null && !error && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}

        {entries?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nobody's on the waitlist right now.
          </p>
        )}

        {entries && entries.length > 0 && (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between rounded-md border border-border px-4 py-3"
              >
                <div>
                  <div className="font-medium">
                    {entry.customer.name}{' '}
                    <Badge variant={badgeVariantByStatus[entry.status]}>
                      {entry.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {entry.customer.contact} · waiting since{' '}
                    {new Date(entry.createdAt).toLocaleDateString()}
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
