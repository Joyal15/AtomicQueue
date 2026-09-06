/**
 * A stable, anonymous per-browser id used to fence a customer's Redis
 * slot hold to the tab that created it (architecture doc §4/§4b). Not a
 * credential and carries no identity — just "which browser is holding
 * this slot". Persisted so a hold survives a component remount.
 */
const KEY = 'atomicqueue.booking.sessionId'

export function getBookingSessionId(): string {
  try {
    const existing = localStorage.getItem(KEY)
    if (existing) return existing
  } catch {
    /* storage blocked — fall through to a fresh, non-persisted id */
  }

  const fresh =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`

  try {
    localStorage.setItem(KEY, fresh)
  } catch {
    /* ignore */
  }
  return fresh
}
