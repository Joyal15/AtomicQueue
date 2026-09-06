import { useEffect, useState, type FormEvent } from 'react'
import { Scissors } from 'lucide-react'

import type { Service } from '@queueless/shared-types'

import { apiFetch, ApiRequestError } from '@/lib/api'
import { useAuth } from '@/lib/use-auth'
import { formatPrice } from '@/lib/format'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SkeletonList } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'

/**
 * Service catalog — GET/POST /api/services, PATCH .../deactivate and
 * .../reactivate (deactivate runs the §2c cascade; there's no hard
 * delete). Owner or staff can view/create/toggle.
 */
export function ServicesPage() {
  const { business } = useAuth()
  const [services, setServices] = useState<Service[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [durationMinutes, setDurationMinutes] = useState(30)
  const [price, setPrice] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function loadServices() {
    try {
      const data = await apiFetch<Service[]>('/services')
      setServices(data)
      setListError(null)
    } catch (err) {
      setListError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not load services.',
      )
    }
  }

  useEffect(() => {
    async function loadOnMount() {
      await loadServices()
    }
    void loadOnMount()
  }, [])

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setFormError(null)

    try {
      await apiFetch<Service>('/services', {
        method: 'POST',
        body: JSON.stringify({
          name,
          durationMinutes: Number(durationMinutes),
          price: Number(price),
        }),
      })
      setName('')
      setDurationMinutes(30)
      setPrice(0)
      await loadServices()
    } catch (err) {
      setFormError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not create the service.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleActive(service: Service) {
    setPendingId(service.id)
    setListError(null)
    try {
      await apiFetch(
        `/services/${service.id}/${service.isActive ? 'deactivate' : 'reactivate'}`,
        { method: 'PATCH' },
      )
      await loadServices()
    } catch (err) {
      setListError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not update the service.',
      )
    } finally {
      setPendingId(null)
    }
  }

  const activeCount = services?.filter((s) => s.isActive).length ?? 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Services"
        description={`What ${business?.name ?? 'your business'} offers to book.`}
      />

      <Card>
        <CardHeader>
          <CardTitle>Add a service</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-[1fr_10rem_10rem_auto] sm:items-end"
            onSubmit={handleCreate}
          >
            {formError && (
              <div className="sm:col-span-full">
                <Alert variant="destructive">{formError}</Alert>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="service-name">Name</Label>
              <Input
                id="service-name"
                required
                placeholder="Haircut"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="service-duration">Duration (min)</Label>
              <Input
                id="service-duration"
                type="number"
                min={1}
                required
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="service-price">Price</Label>
              <Input
                id="service-price"
                type="number"
                min={0}
                required
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
              />
            </div>

            <Button type="submit" disabled={submitting}>
              {submitting && <Spinner />}
              Add
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Catalog</CardTitle>
            {services && services.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {activeCount} active · {services.length - activeCount} inactive
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {listError && <Alert variant="destructive">{listError}</Alert>}

          {services === null && !listError && <SkeletonList rows={3} />}

          {services?.length === 0 && (
            <EmptyState
              icon={Scissors}
              title="No services yet"
              description="Add your first bookable service above — a name, how long it takes, and the price."
            />
          )}

          {services?.map((service) => (
            <div
              key={service.id}
              className="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium">
                  <span className="truncate">{service.name}</span>
                  <Badge variant={service.isActive ? 'success' : 'secondary'}>
                    {service.isActive ? 'active' : 'inactive'}
                  </Badge>
                </p>
                <p className="text-sm text-muted-foreground">
                  {service.durationMinutes} min · {formatPrice(service.price)}
                </p>
              </div>

              <Button
                variant="outline"
                size="sm"
                disabled={pendingId === service.id}
                onClick={() => toggleActive(service)}
              >
                {pendingId === service.id && <Spinner />}
                {service.isActive ? 'Deactivate' : 'Reactivate'}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
