import { useEffect, useState } from 'react'
import { ListChecks } from 'lucide-react'

import { apiFetch, ApiRequestError } from '@/lib/api'
import { formatDate, waitlistStatusBadge } from '@/lib/format'
import { PageHeader } from '@/components/layout/page-header'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonList } from '@/components/ui/skeleton'

interface WaitlistEntry {
  id: string
  businessId: string
  customer: { name: string; contact: string }
  desiredServiceId: string
  desiredProviderId: string | null
  status: 'waiting' | 'notified' | 'expired' | 'converted'
  createdAt: string
}

/**
 * Staff/owner view of who's waiting for a slot to open up. Read-only —
 * matching runs automatically server-side (the Slots lazy-release path
 * triggers it), so there's nothing for staff to action here.
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
    <div className="space-y-6">
      <PageHeader
        title="Waitlist"
        description="Customers waiting on a full time. Notified automatically when a slot frees up."
      />

      {error && <Alert variant="destructive">{error}</Alert>}

      {entries === null && !error && <SkeletonList rows={3} />}

      {entries?.length === 0 && (
        <EmptyState
          icon={ListChecks}
          title="Nobody's waiting"
          description="When a time is full, customers can opt in from the public booking page — they'll appear here."
        />
      )}

      {entries && entries.length > 0 && (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium">
                    <span className="truncate">{entry.customer.name}</span>
                    <Badge variant={waitlistStatusBadge[entry.status]}>
                      {entry.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {entry.customer.contact} · since {formatDate(entry.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
