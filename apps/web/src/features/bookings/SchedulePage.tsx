import { useEffect, useMemo, useState } from 'react'

import type { Slot } from '@queueless/shared-types'

import { apiFetch, ApiRequestError } from '@/lib/api'
import { useAuth } from '@/lib/use-auth'
import { useSlotUpdates } from '@/lib/realtime'
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

/**
 * "Provider" (staff or resource, unified) isn't published to shared-types
 * yet, so this is typed locally to match GET /api/providers's response.
 */
interface Provider {
  providerId: string
  providerType: 'staff' | 'resource'
  businessId: string
  name: string
  status: 'active' | 'removed'
  capacity: number
  role: 'owner' | 'staff' | null
}

const badgeVariantByStatus: Record<
  Slot['status'],
  'default' | 'secondary' | 'destructive'
> = {
  available: 'default',
  held: 'secondary',
  confirmed: 'secondary',
  blocked: 'destructive',
  cancelled: 'destructive',
}

function providerKey(providerId: string, providerType: string): string {
  return `${providerType}:${providerId}`
}

/**
 * Staff/owner schedule view — lists one provider's slots and updates them
 * live over Socket.IO (`slot:updated`) as they change, e.g. from another
 * tab blocking or booking one. Also exposes the two owner-facing slot
 * actions that had no UI yet: generating next week's slots from
 * availability templates, and manually blocking a slot.
 */
export function SchedulePage() {
  const { user } = useAuth()
  const isOwner = user?.role === 'owner'

  const [providers, setProviders] = useState<Provider[] | null>(null)
  const [providersError, setProvidersError] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string>('')

  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [slotsError, setSlotsError] = useState<string | null>(null)
  const [blockingId, setBlockingId] = useState<string | null>(null)
  // Tracks which provider `slots` currently belongs to, so switching
  // providers can clear the stale list immediately (see the render-time
  // reset below) instead of briefly showing the previous provider's slots.
  const [loadedProviderKey, setLoadedProviderKey] = useState<string | null>(
    null,
  )

  const [generating, setGenerating] = useState(false)
  const [generateResult, setGenerateResult] = useState<string | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)

  const selectedProvider = useMemo(
    () =>
      providers?.find(
        (p) => providerKey(p.providerId, p.providerType) === selectedKey,
      ) ?? null,
    [providers, selectedKey],
  )

  // Resetting local state in response to a prop/state change (not a side
  // effect) belongs during render, not in an effect — React's own
  // "adjusting state when a prop changes" pattern. Guarded so it only
  // fires once per actual key change, not every render.
  if (selectedProvider && loadedProviderKey !== selectedKey) {
    setLoadedProviderKey(selectedKey)
    setSlots(null)
  }

  useEffect(() => {
    async function loadProviders() {
      try {
        const data = await apiFetch<Provider[]>('/providers')
        setProviders(data)
        if (data.length > 0 && !selectedKey) {
          setSelectedKey(providerKey(data[0].providerId, data[0].providerType))
        }
        setProvidersError(null)
      } catch (err) {
        setProvidersError(
          err instanceof ApiRequestError
            ? err.message
            : 'Could not load providers.',
        )
      }
    }
    void loadProviders()
    // Only ever needs to run once — providers rarely change while this
    // page is open, and re-running would clobber the user's selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadSlots(provider: Provider) {
    try {
      const data = await apiFetch<Slot[]>(
        `/slots?providerId=${encodeURIComponent(provider.providerId)}&providerType=${provider.providerType}`,
      )
      setSlots(data)
      setSlotsError(null)
    } catch (err) {
      setSlotsError(
        err instanceof ApiRequestError ? err.message : 'Could not load slots.',
      )
    }
  }

  useEffect(() => {
    if (!selectedProvider) return
    // Matches the loadProviders effect above: the fetch needs to be a
    // function declared inside the effect itself, not merely called from
    // it, for the linter to see setSlots as happening after the await
    // rather than synchronously within the effect. loadSlots stays a
    // standalone function too, for handleGenerate's reuse below.
    async function run(provider: Provider) {
      await loadSlots(provider)
    }
    void run(selectedProvider)
  }, [selectedProvider])

  // Live updates: the backend's event contract is still draft (see
  // lib/realtime.ts) and only ever carries a slotId/status pair today —
  // patch the matching row in place rather than refetching the whole list.
  useSlotUpdates((payload) => {
    if (!('slotId' in payload)) return
    setSlots((current) =>
      current?.map((slot) =>
        slot.id === payload.slotId
          ? { ...slot, status: payload.status as Slot['status'] }
          : slot,
      ) ?? current,
    )
  })

  async function handleGenerate() {
    setGenerating(true)
    setGenerateError(null)
    setGenerateResult(null)

    try {
      const result = await apiFetch<{
        created: number
        skippedExisting: number
        skippedInactiveProviders: number
      }>('/slots/generate', { method: 'POST', body: JSON.stringify({}) })

      setGenerateResult(
        `Created ${result.created} slot(s). ${result.skippedExisting} already existed, ${result.skippedInactiveProviders} provider template(s) skipped.`,
      )

      if (selectedProvider) await loadSlots(selectedProvider)
    } catch (err) {
      setGenerateError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not generate slots.',
      )
    } finally {
      setGenerating(false)
    }
  }

  async function handleBlock(slotId: string) {
    setBlockingId(slotId)
    setSlotsError(null)

    try {
      await apiFetch(`/slots/${slotId}/block`, { method: 'POST' })
      // No need to refetch — the realtime listener above will also patch
      // this row, but update optimistically so it's instant even if the
      // socket hasn't delivered yet.
      setSlots((current) =>
        current?.map((slot) =>
          slot.id === slotId ? { ...slot, status: 'blocked' } : slot,
        ) ?? current,
      )
    } catch (err) {
      setSlotsError(
        err instanceof ApiRequestError ? err.message : 'Could not block the slot.',
      )
    } finally {
      setBlockingId(null)
    }
  }

  return (
    <div className="space-y-6">
      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle>Generate slots</CardTitle>
            <CardDescription>
              Turns each provider's weekly availability template into
              bookable slots for the next 7 days. Safe to run repeatedly —
              it never creates duplicates.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={handleGenerate} disabled={generating}>
              {generating ? 'Generating…' : 'Generate next 7 days'}
            </Button>
            {generateError && <Alert variant="destructive">{generateError}</Alert>}
            {generateResult && <Alert>{generateResult}</Alert>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
          <CardDescription>
            Live — updates automatically when a slot's status changes
            elsewhere (another tab, another staff member).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {providersError && <Alert variant="destructive">{providersError}</Alert>}

          {providers?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No providers yet — add a staff member or a resource first.
            </p>
          )}

          {providers && providers.length > 0 && (
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-64"
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
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
          )}

          {slotsError && <Alert variant="destructive">{slotsError}</Alert>}

          {selectedProvider && slots === null && !slotsError && (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}

          {selectedProvider && slots?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No slots for this provider yet
              {isOwner ? ' — generate some above.' : '.'}
            </p>
          )}

          {slots && slots.length > 0 && (
            <div className="space-y-2">
              {slots.map((slot) => (
                <div
                  key={slot.id}
                  className="flex items-center justify-between rounded-md border border-border px-4 py-3"
                >
                  <div>
                    <div className="font-medium">
                      {new Date(slot.datetime).toLocaleString()}{' '}
                      <Badge variant={badgeVariantByStatus[slot.status]}>
                        {slot.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {slot.durationMinutes} min · unit {slot.unitIndex}
                    </p>
                  </div>

                  {slot.status === 'available' && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={blockingId === slot.id}
                      onClick={() => handleBlock(slot.id)}
                    >
                      {blockingId === slot.id ? 'Blocking…' : 'Block'}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
