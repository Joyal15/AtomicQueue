import { useEffect, useState, type FormEvent } from 'react'

import type { Service } from '@queueless/shared-types'

import { apiFetch, ApiRequestError } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Service catalog — GET/POST /api/services, DELETE /api/services/:id
 * (which deactivates, per architecture doc Section 2c — never a hard
 * delete). Owner or staff can view/create (architecture Section 9);
 * deactivation follows the same rule.
 */
export function ServicesPage() {
  const { business } = useAuth()
  const [services, setServices] = useState<Service[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)

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
    loadServices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  async function handleDeactivate(serviceId: string) {
    try {
      await apiFetch(`/services/${serviceId}`, { method: 'DELETE' })
      await loadServices()
    } catch (err) {
      setListError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not deactivate the service.',
      )
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add a service</CardTitle>
          <CardDescription>
            What {business?.name ?? 'your business'} offers to book.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-3" onSubmit={handleCreate}>
            {formError && (
              <div className="sm:col-span-3">
                <Alert variant="destructive">{formError}</Alert>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="service-name">Name</Label>
              <Input
                id="service-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="service-duration">Duration (minutes)</Label>
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

            <div className="sm:col-span-3">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Adding…' : 'Add service'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Services</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {listError && <Alert variant="destructive">{listError}</Alert>}

          {services === null && !listError && (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}

          {services?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No services yet — add one above.
            </p>
          )}

          {services?.map((service) => (
            <div
              key={service.id}
              className="flex items-center justify-between rounded-md border border-border px-4 py-3"
            >
              <div>
                <p className="font-medium">
                  {service.name}{' '}
                  <Badge variant={service.isActive ? 'default' : 'secondary'}>
                    {service.isActive ? 'active' : 'inactive'}
                  </Badge>
                </p>
                <p className="text-sm text-muted-foreground">
                  {service.durationMinutes} min · {service.price}
                </p>
              </div>

              {service.isActive && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDeactivate(service.id)}
                >
                  Deactivate
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
