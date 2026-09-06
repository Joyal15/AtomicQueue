import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { CalendarClock, CalendarRange, Pencil, Plus, Trash2 } from 'lucide-react'

import type {
  ProviderAvailability,
  Service,
  Slot,
  WeeklyAvailabilityWindow,
} from '@queueless/shared-types'

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
import { Dialog } from '@/components/ui/dialog'
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

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function providerKey(providerId: string, providerType: string): string {
  return `${providerType}:${providerId}`
}

/** "09:00" -> "9:00 AM" — a fixed reference date, only the time is used. */
function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(2000, 0, 1, h, m)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/**
 * Turns a template's raw per-day windows into 1-2 readable lines, e.g.
 * "Mon–Fri · 9:00 AM–5:00 PM" or, when days don't share one range,
 * one comma-separated group per distinct time range.
 */
function summarizeWindows(windows: WeeklyAvailabilityWindow[]): string {
  if (windows.length === 0) return 'No hours set yet'

  const byRange = new Map<string, number[]>()
  for (const w of windows) {
    const key = `${w.startTime}-${w.endTime}`
    const days = byRange.get(key) ?? []
    days.push(w.dayOfWeek)
    byRange.set(key, days)
  }

  const groups = [...byRange.entries()].map(([range, days]) => {
    const [start, end] = range.split('-')
    const sorted = [...days].sort((a, b) => a - b)
    const dayLabel = formatDayRuns(sorted)
    return `${dayLabel} · ${formatClock(start)}–${formatClock(end)}`
  })

  return groups.join('; ')
}

/** [1,2,3,5] -> "Mon–Wed, Fri" — collapses consecutive days into a range. */
function formatDayRuns(sortedDays: number[]): string {
  const runs: string[] = []
  let runStart = sortedDays[0]
  let runEnd = sortedDays[0]

  function pushRun() {
    runs.push(
      runStart === runEnd
        ? DAY_LABELS[runStart]
        : runEnd === runStart + 1
          ? `${DAY_LABELS[runStart]}, ${DAY_LABELS[runEnd]}`
          : `${DAY_LABELS[runStart]}–${DAY_LABELS[runEnd]}`,
    )
  }

  for (let i = 1; i < sortedDays.length; i += 1) {
    if (sortedDays[i] === runEnd + 1) {
      runEnd = sortedDays[i]
    } else {
      pushRun()
      runStart = sortedDays[i]
      runEnd = sortedDays[i]
    }
  }
  pushRun()

  return runs.join(', ')
}

/**
 * Staff/owner schedule view — one provider's weekly availability
 * templates, generated slots, and the two slot actions: generating the
 * next week from those templates, and manually blocking a slot.
 */
export function SchedulePage() {
  const { user } = useAuth()
  const isOwner = user?.role === 'owner'

  const [providers, setProviders] = useState<Provider[] | null>(null)
  const [providersError, setProvidersError] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string>('')

  const [services, setServices] = useState<Service[] | null>(null)

  const [templates, setTemplates] = useState<ProviderAvailability[] | null>(
    null,
  )
  const [templatesError, setTemplatesError] = useState<string | null>(null)
  const [editorState, setEditorState] = useState<
    { mode: 'create' } | { mode: 'edit'; template: ProviderAvailability } | null
  >(null)
  const [deletingTemplate, setDeletingTemplate] =
    useState<ProviderAvailability | null>(null)

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
    setTemplates(null)
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

  useEffect(() => {
    async function loadServices() {
      try {
        setServices(await apiFetch<Service[]>('/services'))
      } catch {
        // Non-fatal — the availability card just shows raw ids as a
        // fallback (see serviceName() below) if this never loads.
      }
    }
    void loadServices()
  }, [])

  async function loadTemplates(provider: Provider) {
    try {
      const data = await apiFetch<ProviderAvailability[]>(
        `/availability?providerId=${encodeURIComponent(provider.providerId)}`,
      )
      setTemplates(data)
      setTemplatesError(null)
    } catch (err) {
      setTemplatesError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not load availability.',
      )
    }
  }

  useEffect(() => {
    if (!selectedProvider) return
    async function run(provider: Provider) {
      await loadTemplates(provider)
    }
    void run(selectedProvider)
  }, [selectedProvider])

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

  function serviceName(serviceId: string): string {
    return services?.find((s) => s.id === serviceId)?.name ?? 'Unknown service'
  }

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

  async function handleDeleteTemplate() {
    if (!deletingTemplate) return
    try {
      await apiFetch(`/availability/${deletingTemplate.id}`, {
        method: 'DELETE',
      })
      setDeletingTemplate(null)
      if (selectedProvider) await loadTemplates(selectedProvider)
    } catch (err) {
      setTemplatesError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not remove that availability.',
      )
      setDeletingTemplate(null)
    }
  }

  const days = slots ? groupByDay(slots) : []
  const activeServices = services?.filter((s) => s.isActive) ?? []
  const servicesWithoutTemplate = activeServices.filter(
    (s) => !templates?.some((t) => t.serviceId === s.id),
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Schedule"
        description="Live — updates the moment a slot changes anywhere, no refresh."
      />

      <Card>
        <CardContent className="py-5">
          {providersError && (
            <Alert variant="destructive">{providersError}</Alert>
          )}

          {providers === null && !providersError && <SkeletonList rows={2} />}

          {providers?.length === 0 && (
            <EmptyState
              icon={CalendarRange}
              title="No providers yet"
              description="Add a staff member or a resource before setting up availability."
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
        </CardContent>
      </Card>

      {selectedProvider && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Weekly availability</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  The working hours {selectedProvider.name} is bookable for
                  each service — this is what "Generate slots" below reads.
                </p>
              </div>
              {templates && activeServices.length > 0 && (
                <Button
                  size="sm"
                  disabled={servicesWithoutTemplate.length === 0}
                  title={
                    servicesWithoutTemplate.length === 0
                      ? 'Every active service already has hours set — edit one below instead.'
                      : undefined
                  }
                  onClick={() => setEditorState({ mode: 'create' })}
                >
                  <Plus className="size-4" />
                  Add hours
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {templatesError && (
              <Alert variant="destructive">{templatesError}</Alert>
            )}

            {templates === null && !templatesError && <SkeletonList rows={2} />}

            {templates?.length === 0 && activeServices.length === 0 && (
              <EmptyState
                icon={CalendarClock}
                title="No active services yet"
                description="Add a service under Services first — availability is set per service."
              />
            )}

            {templates?.length === 0 && activeServices.length > 0 && (
              <EmptyState
                icon={CalendarClock}
                title="No hours set yet"
                description={`Add hours for a service ${selectedProvider.name} offers, so slots can be generated for it.`}
                action={
                  <Button size="sm" onClick={() => setEditorState({ mode: 'create' })}>
                    <Plus className="size-4" />
                    Add hours
                  </Button>
                }
              />
            )}

            {templates && templates.length > 0 && (
              <div className="divide-y divide-border rounded-md border border-border">
                {templates.map((template) => (
                  <div
                    key={template.id}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {serviceName(template.serviceId)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {summarizeWindows(template.weeklyWindows)}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditorState({ mode: 'edit', template })}
                      >
                        <Pencil className="size-3.5" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove availability for ${serviceName(template.serviceId)}`}
                        onClick={() => setDeletingTemplate(template)}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
          {slotsError && <Alert variant="destructive">{slotsError}</Alert>}

          {selectedProvider && slots === null && !slotsError && (
            <SkeletonList rows={3} />
          )}

          {selectedProvider && slots?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No slots for this provider yet
              {isOwner ? ' — set hours and generate some above.' : '.'}
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

      {selectedProvider && editorState && (
        <AvailabilityEditorDialog
          provider={selectedProvider}
          template={editorState.mode === 'edit' ? editorState.template : null}
          serviceOptions={
            editorState.mode === 'create'
              ? servicesWithoutTemplate
              : activeServices.filter(
                  (s) => s.id === editorState.template.serviceId,
                )
          }
          onClose={() => setEditorState(null)}
          onDone={async () => {
            setEditorState(null)
            await loadTemplates(selectedProvider)
          }}
        />
      )}

      <Dialog
        open={deletingTemplate !== null}
        onClose={() => setDeletingTemplate(null)}
        title="Remove these hours?"
        description={
          deletingTemplate
            ? `${serviceName(deletingTemplate.serviceId)} won't generate new slots for ${selectedProvider?.name ?? 'this provider'} anymore. Slots already generated are unaffected.`
            : undefined
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setDeletingTemplate(null)}>
              Keep hours
            </Button>
            <Button variant="destructive" onClick={handleDeleteTemplate}>
              Remove
            </Button>
          </>
        }
      />
    </div>
  )
}

interface DayRowState {
  enabled: boolean
  startTime: string
  endTime: string
}

const DEFAULT_START = '09:00'
const DEFAULT_END = '17:00'
/** Mon–Fri on by default — the common case for a new template. */
const DEFAULT_ENABLED_DAYS = new Set([1, 2, 3, 4, 5])

function buildInitialDayRows(
  template: ProviderAvailability | null,
): DayRowState[] {
  if (!template) {
    return DAY_LABELS.map((_, i) => ({
      enabled: DEFAULT_ENABLED_DAYS.has(i),
      startTime: DEFAULT_START,
      endTime: DEFAULT_END,
    }))
  }

  return DAY_LABELS.map((_, i) => {
    const window = template.weeklyWindows.find((w) => w.dayOfWeek === i)
    return {
      enabled: window !== undefined,
      startTime: window?.startTime ?? DEFAULT_START,
      endTime: window?.endTime ?? DEFAULT_END,
    }
  })
}

function AvailabilityEditorDialog({
  provider,
  template,
  serviceOptions,
  onClose,
  onDone,
}: {
  provider: Provider
  template: ProviderAvailability | null
  serviceOptions: Service[]
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const isEdit = template !== null
  const [serviceId, setServiceId] = useState(
    template?.serviceId ?? serviceOptions[0]?.id ?? '',
  )
  const [rows, setRows] = useState<DayRowState[]>(() =>
    buildInitialDayRows(template),
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({})

  function updateRow(index: number, patch: Partial<DayRowState>) {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    )
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (!serviceId) {
      setError('Choose a service.')
      return
    }

    const nextRowErrors: Record<number, string> = {}
    rows.forEach((row, i) => {
      if (!row.enabled) return
      if (!row.startTime || !row.endTime) {
        nextRowErrors[i] = 'Set both a start and end time.'
      } else if (row.startTime >= row.endTime) {
        nextRowErrors[i] = 'End time must be after start time.'
      }
    })
    setRowErrors(nextRowErrors)
    if (Object.keys(nextRowErrors).length > 0) return

    const weeklyWindows: WeeklyAvailabilityWindow[] = rows
      .map((row, dayOfWeek) => ({ row, dayOfWeek }))
      .filter(({ row }) => row.enabled)
      .map(({ row, dayOfWeek }) => ({
        dayOfWeek,
        startTime: row.startTime,
        endTime: row.endTime,
      }))

    setSubmitting(true)
    try {
      if (isEdit) {
        await apiFetch(`/availability/${template.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ weeklyWindows }),
        })
      } else {
        await apiFetch('/availability', {
          method: 'POST',
          body: JSON.stringify({
            providerId: provider.providerId,
            providerType: provider.providerType,
            serviceId,
            weeklyWindows,
          }),
        })
      }
      await onDone()
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not save availability.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const enabledCount = rows.filter((r) => r.enabled).length

  return (
    <Dialog
      open
      onClose={onClose}
      title={isEdit ? 'Edit hours' : 'Add hours'}
      description={
        isEdit
          ? `${provider.name} · ${serviceOptions[0]?.name ?? 'this service'}`
          : `Set ${provider.name}'s weekly hours for one service.`
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="availability-editor-form"
            disabled={submitting}
          >
            {submitting && <Spinner />}
            Save hours
          </Button>
        </>
      }
    >
      <form
        id="availability-editor-form"
        className="space-y-4"
        onSubmit={handleSubmit}
      >
        {error && <Alert variant="destructive">{error}</Alert>}

        {!isEdit && (
          <div className="space-y-2">
            <Label htmlFor="availability-service">Service</Label>
            {serviceOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every active service already has hours set for this provider.
              </p>
            ) : (
              <Select
                id="availability-service"
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
              >
                {serviceOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Days &amp; hours</Label>
          <div className="divide-y divide-border rounded-md border border-border">
            {rows.map((row, i) => (
              <div key={DAY_LABELS[i]} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
                <label className="flex w-24 shrink-0 items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(e) => updateRow(i, { enabled: e.target.checked })}
                    className="size-4 rounded border-input accent-primary"
                  />
                  {DAY_LABELS[i]}
                </label>
                <div className="flex flex-1 items-center gap-2">
                  <input
                    type="time"
                    value={row.startTime}
                    disabled={!row.enabled}
                    onChange={(e) => updateRow(i, { startTime: e.target.value })}
                    aria-label={`${DAY_LABELS[i]} start time`}
                    className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                  />
                  <span className="text-muted-foreground">–</span>
                  <input
                    type="time"
                    value={row.endTime}
                    disabled={!row.enabled}
                    onChange={(e) => updateRow(i, { endTime: e.target.value })}
                    aria-label={`${DAY_LABELS[i]} end time`}
                    className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </div>
                {rowErrors[i] && (
                  <p className="text-xs text-destructive sm:basis-full">
                    {rowErrors[i]}
                  </p>
                )}
              </div>
            ))}
          </div>
          {enabledCount === 0 && (
            <p className="text-xs text-muted-foreground">
              No days selected — this pauses generation for this service
              without deleting it.
            </p>
          )}
        </div>
      </form>
    </Dialog>
  )
}
