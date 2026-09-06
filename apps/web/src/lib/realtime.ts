import { useEffect, useRef } from 'react'
import { io, type Socket } from 'socket.io-client'

/**
 * Matches the backend realtime module's locked `slot:updated` contract
 * (`apps/api/src/modules/realtime/realtime.gateway.ts`): a `{ slotId,
 * status }` shape for a single slot's status flip, and a `{ providerId,
 * providerType, datetime, remaining }` shape for a bucket whose
 * remaining count changed (a confirm consuming a unit).
 */
export type SlotUpdatePayload =
  | { slotId: string; status: string }
  | {
      providerId: string
      providerType: 'staff' | 'resource'
      datetime: string
      remaining: number
    }

const SLOT_UPDATED_EVENT = 'slot:updated'

// One shared connection per page load. Staff/owner pages authenticate
// via the session cookie (no arg). The public booking page has no
// session, so it passes the business `slug` in the handshake auth — the
// server resolves that to a businessId and joins the tenant room (the
// slug is public and already in the page URL; the client never names a
// room directly).
let sharedSocket: Socket | null = null
let sharedSocketKey: string | null = null

function getSocket(slug?: string): Socket {
  const key = slug ?? '__session__'
  if (sharedSocket && sharedSocketKey === key) {
    return sharedSocket
  }
  if (sharedSocket) {
    sharedSocket.disconnect()
    sharedSocket = null
  }
  sharedSocket = io({
    path: '/socket.io',
    withCredentials: true,
    auth: slug ? { slug } : {},
  })
  sharedSocketKey = key
  return sharedSocket
}

/**
 * Subscribes to live `slot:updated` events while the calling component
 * is mounted. Pass `slug` on a public (unauthenticated) page; omit it on
 * staff/owner pages. Best-effort — a missed event just means the UI is
 * stale until the next refetch.
 */
export function useSlotUpdates(
  onUpdate: (payload: SlotUpdatePayload) => void,
  slug?: string,
): void {
  const handlerRef = useRef(onUpdate)

  useEffect(() => {
    handlerRef.current = onUpdate
  })

  useEffect(() => {
    const socket = getSocket(slug)
    const listener = (payload: SlotUpdatePayload) => handlerRef.current(payload)

    socket.on(SLOT_UPDATED_EVENT, listener)

    return () => {
      socket.off(SLOT_UPDATED_EVENT, listener)
    }
  }, [slug])
}
