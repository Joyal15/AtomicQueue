import { useEffect, useState, type FormEvent } from 'react'

import { apiFetch, ApiRequestError } from '@/lib/api'
import { useAuth } from '@/lib/use-auth'
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
 * Staff invitations — architecture doc Section 9b. There's no shared
 * `StaffInvitation` type yet (it's not in packages/shared-types), so
 * this is typed locally against what the API's controller actually
 * returns (apps/api/.../staffInvitations.controller.ts).
 */
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

const badgeVariantByStatus: Record<
  StaffInvitation['status'],
  'default' | 'secondary' | 'destructive'
> = {
  pending: 'default',
  accepted: 'secondary',
  revoked: 'destructive',
  expired: 'destructive',
}

export function StaffPage() {
  const { user } = useAuth()
  const isOwner = user?.role === 'owner'

  const [invitations, setInvitations] = useState<StaffInvitation[] | null>(
    null,
  )
  const [listError, setListError] = useState<string | null>(null)

  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  // There's no email delivery yet (that's Phase 4's notifications
  // module) — the create-invitation endpoint returns the raw token
  // directly for exactly this reason. Surface it so an invite is
  // actually usable end to end today.
  const [lastInvite, setLastInvite] = useState<CreatedInvitation | null>(
    null,
  )

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
    // Defined and invoked inline — see the matching comment in
    // ServicesPage.tsx for why (react-hooks/set-state-in-effect).
    async function loadOnMount() {
      if (isOwner) {
        await loadInvitations()
      }
    }
    void loadOnMount()
  }, [isOwner])

  async function handleInvite(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setFormError(null)
    setLastInvite(null)

    try {
      const invitation = await apiFetch<CreatedInvitation>(
        '/tenants/invitations',
        {
          method: 'POST',
          body: JSON.stringify({ email }),
        },
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
      <Card>
        <CardHeader>
          <CardTitle>Staff</CardTitle>
          <CardDescription>
            Only the business owner can invite or manage staff.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Invite staff</CardTitle>
          <CardDescription>
            Sends an invitation the invitee accepts to create their staff
            account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="flex gap-3" onSubmit={handleInvite}>
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
            <Button type="submit" className="self-end" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send invite'}
            </Button>
          </form>

          {formError && <Alert variant="destructive">{formError}</Alert>}

          {lastInvite && (
            <Alert>
              Invitation sent to <strong>{lastInvite.email}</strong>. No
              email delivery yet — share this token with them manually:
              <br />
              <code className="mt-1 block break-all rounded bg-secondary px-2 py-1 text-xs">
                {lastInvite.token}
              </code>
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

          {invitations === null && !listError && (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}

          {invitations?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No invitations yet — invite someone above.
            </p>
          )}

          {invitations?.map((invitation) => (
            <div
              key={invitation.id}
              className="flex items-center justify-between rounded-md border border-border px-4 py-3"
            >
              <div>
                <p className="font-medium">
                  {invitation.email}{' '}
                  <Badge variant={badgeVariantByStatus[invitation.status]}>
                    {invitation.status}
                  </Badge>
                </p>
                <p className="text-sm text-muted-foreground">
                  Expires {new Date(invitation.expiresAt).toLocaleString()}
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
