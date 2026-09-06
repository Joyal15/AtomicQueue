import { useEffect, useState, type FormEvent } from 'react'
import { Copy, Users } from 'lucide-react'

import { apiFetch, ApiRequestError } from '@/lib/api'
import { useAuth } from '@/lib/use-auth'
import { formatDateTime, invitationStatusBadge } from '@/lib/format'
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

interface StaffInvitation {
  id: string
  businessId: string
  email: string
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  invitedBy: string
  expiresAt: string
  acceptedAt: string | null
}

interface CreatedInvitation {
  id: string
  businessId: string
  email: string
  token: string
  expiresAt: string
}

export function StaffPage() {
  const { user } = useAuth()
  const isOwner = user?.role === 'owner'

  const [invitations, setInvitations] = useState<StaffInvitation[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [lastInvite, setLastInvite] = useState<CreatedInvitation | null>(null)
  const [copied, setCopied] = useState(false)

  async function loadInvitations() {
    try {
      const data = await apiFetch<StaffInvitation[]>('/tenants/invitations')
      setInvitations(data)
      setListError(null)
    } catch (err) {
      setListError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not load invitations.',
      )
    }
  }

  useEffect(() => {
    async function loadOnMount() {
      if (isOwner) await loadInvitations()
    }
    void loadOnMount()
  }, [isOwner])

  async function handleInvite(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setFormError(null)
    setLastInvite(null)
    setCopied(false)

    try {
      const invitation = await apiFetch<CreatedInvitation>(
        '/tenants/invitations',
        { method: 'POST', body: JSON.stringify({ email }) },
      )
      setLastInvite(invitation)
      setEmail('')
      await loadInvitations()
    } catch (err) {
      setFormError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not send the invitation.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRevoke(invitationId: string) {
    try {
      await apiFetch(`/tenants/invitations/${invitationId}`, {
        method: 'DELETE',
      })
      await loadInvitations()
    } catch (err) {
      setListError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not revoke the invitation.',
      )
    }
  }

  if (!isOwner) {
    return (
      <div className="space-y-6">
        <PageHeader title="Staff" />
        <EmptyState
          icon={Users}
          title="Owner only"
          description="Only the business owner can invite or manage staff."
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff"
        description="Invite people to help run bookings. They accept the invite to create their own login."
      />

      <Card>
        <CardHeader>
          <CardTitle>Invite staff</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={handleInvite}>
            <div className="flex-1 space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting && <Spinner />}
              Send invite
            </Button>
          </form>

          {formError && <Alert variant="destructive">{formError}</Alert>}

          {lastInvite && (
            <Alert variant="success">
              <p>
                Invitation created for <strong>{lastInvite.email}</strong>.
                Email delivery isn't wired up yet — share this token with them:
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-card px-2 py-1 text-xs text-foreground">
                  {lastInvite.token}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(lastInvite.token)
                      setCopied(true)
                    } catch {
                      /* clipboard blocked — token is visible anyway */
                    }
                  }}
                >
                  <Copy className="size-3.5" />
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invitations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {listError && <Alert variant="destructive">{listError}</Alert>}

          {invitations === null && !listError && <SkeletonList rows={2} />}

          {invitations?.length === 0 && (
            <EmptyState
              icon={Users}
              title="No invitations yet"
              description="Invite a teammate above to get started."
            />
          )}

          {invitations?.map((invitation) => (
            <div
              key={invitation.id}
              className="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium">
                  <span className="truncate">{invitation.email}</span>
                  <Badge variant={invitationStatusBadge[invitation.status]}>
                    {invitation.status}
                  </Badge>
                </p>
                <p className="text-sm text-muted-foreground">
                  Expires {formatDateTime(invitation.expiresAt)}
                </p>
              </div>

              {invitation.status === 'pending' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRevoke(invitation.id)}
                >
                  Revoke
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
