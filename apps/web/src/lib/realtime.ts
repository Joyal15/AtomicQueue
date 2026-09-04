import { useEffect, useRef } from 'react'
import { io, type Socket } from 'socket.io-client'

/**
 * Mirrors the backend's realtime module (`apps/api/src/modules/realtime`),
 * which explicitly documents this as a DRAFT contract not yet agreed with
 * the bookings module — not published to `@queueless/shared-types` for
 * that reason. Expect this shape to change.
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

// One shared connection per page load, created lazily the first time a
// component actually needs it (never on the login/signup pages, since
// nothing there calls useSlotUpdates). Cookie-based auth, so no token is
// passed here — the server resolves identity from the session cookie at
// handshake, same as every HTTP request (see apiFetch).
let sharedSocket: Socket | null = null

function getSocket(): Socket {
  if (!sharedSocket) {
    sharedSocket = io({
      path: '/socket.io',
      withCredentials: true,
    })
  }
  return sharedSocket
}

/**
 * Subscribes to live `slot:updated` events for as long as the calling
 * component is mounted. Best-effort, same as the backend emit — a missed
 * event just means the UI is stale until the next normal refetch, nothing
 * ever depends on this arriving.
 */
export function useSlotUpdates(
  onUpdate: (payload: SlotUpdatePayload) => void,
): void {
  const handlerRef = useRef(onUpdate)

  // Keep the ref pointed at the latest callback without re-subscribing
  // the socket listener below on every render. Writing to a ref must
  // happen in an effect, not during render itself.
  useEffect(() => {
    handlerRef.current = onUpdate
  })

  useEffect(() => {
    const socket = getSocket()
    const listener = (payload: SlotUpdatePayload) => handlerRef.current(payload)

    socket.on(SLOT_UPDATED_EVENT, listener)

    return () => {
      socket.off(SLOT_UPDATED_EVENT, listener)
    }
  }, [])
}
