import { useEffect, useMemo, useState } from 'react'
import { CalendarRange } from 'lucide-react'

import type { Slot } from '@queueless/shared-types'

import { apiFetch, ApiRequestError } from '@/lib/api'
import { useAuth } from '@/lib/use-auth'
import { useSlotUpdates } from '@/lib/realtime'
import { formatTime, groupByDay, slotStatusBadge } from '@/lib/format'
import { PageHeader } from '@/components/layout/page-header'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { SkeletonList } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'

/** "Provider" isn't published to shared-types yet — matches GET /api/providers. */
interface Provider {
  providerId: string
  providerType: 'staff' | 'resource'
  businessId: string
  name: string
  status: 'active' | 'removed'
  capacity: number
  role: 'owner' | 'staff' | null
}

function providerKey(providerId: string, providerType: string): string {
  return `${providerType}:${providerId}`
}

/**
 * Staff/owner schedule view — one provider's slots, updated live over
 * Socket.IO (`slot:updated`) as they change. Also exposes the two
 * owner slot actions: generating next week's slots from availability
 * templates, and manually blocking a slot.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadSlots(provider: Provider) {
    try {
      const data = await apiFetch<Slot[]>(
        `/slots?providerId=${encodeURIComponent(provider.providerId)}&providerType=${provider.providerType}`,
      )
      setSlots(
        [...data].sort(
          (a, b) =>
            new Date(a.datetime).getTime() - new Date(b.datetime).getTime(),
        ),
      )
      setSlotsError(null)
    } catch (err) {
      setSlotsError(
        err instanceof ApiRequestError ? err.message : 'Could not load slots.',
      )
    }
  }

  useEffect(() => {
    if (!selectedProvider) return
    async function run(provider: Provider) {
      await loadSlots(provider)
    }
    void run(selectedProvider)
  }, [selectedProvider])

  useSlotUpdates((payload) => {
    if (!('slotId' in payload)) return
    setSlots(
      (current) =>
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
        `Created ${result.created} slot(s). ${result.skippedExisting} already existed; ${result.skippedInactiveProviders} template(s) skipped.`,
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
      setSlots(
        (current) =>
          current?.map((slot) =>
            slot.id === slotId ? { ...slot, status: 'blocked' } : slot,
          ) ?? current,
      )
    } catch (err) {
      setSlotsError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not block the slot.',
      )
    } finally {
      setBlockingId(null)
    }
  }

  const days = slots ? groupByDay(slots) : []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Schedule"
        description="Live — updates the moment a slot changes anywhere, no refresh."
      />

      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle>Generate slots</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Turns each provider's weekly availability template into bookable
              slots for the next 7 days. Safe to run repeatedly — it never
              duplicates.
            </p>
            <Button onClick={handleGenerate} disabled={generating}>
              {generating && <Spinner />}
              Generate next 7 days
            </Button>
            {generateError && (
              <Alert variant="destructive">{generateError}</Alert>
            )}
            {generateResult && (
              <Alert variant="success">{generateResult}</Alert>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Slots</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {providersError && (
            <Alert variant="destructive">{providersError}</Alert>
          )}

          {providers === null && !providersError && <SkeletonList rows={3} />}

          {providers?.length === 0 && (
            <EmptyState
              icon={CalendarRange}
              title="No providers yet"
              description="Add a staff member or a resource, then set their weekly availability, before generating slots."
            />
          )}

          {providers && providers.length > 0 && (
            <div className="max-w-xs space-y-2">
              <Label htmlFor="schedule-provider">Provider</Label>
              <Select
                id="schedule-provider"
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
              </Select>
            </div>
          )}

          {slotsError && <Alert variant="destructive">{slotsError}</Alert>}

          {selectedProvider && slots === null && !slotsError && (
            <SkeletonList rows={3} />
          )}

          {selectedProvider && slots?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No slots for this provider yet
              {isOwner ? ' — generate some above.' : '.'}
            </p>
          )}

          {days.map((day) => (
            <div key={day.key}>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {day.label}
              </p>
              <div className="divide-y divide-border rounded-md border border-border">
                {day.items.map((slot) => (
                  <div
                    key={slot.id}
                    className="flex items-center justify-between gap-4 px-4 py-2.5"
                  >
                    <div>
                      <div className="flex items-center gap-2 font-medium">
                        {formatTime(slot.datetime)}
                        <Badge variant={slotStatusBadge[slot.status]}>
                          {slot.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
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
                        {blockingId === slot.id && <Spinner />}
                        Block
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
