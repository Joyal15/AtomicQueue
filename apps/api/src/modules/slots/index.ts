/**
 * Public surface of the Slots module. Other modules import from
 * here, not from `slots.model.ts` directly.
 */

export {
  generateWeeklySlots,
  listSlots,
  listHeldSlots,
  getSlotById,
  getAvailableSlots,
  getPublicAvailabilityBuckets,
  getRemainingCapacity,
  blockSlot,
  confirmAvailableSlot,
  claimSlot,
  releaseHeldSlot,
  cancelConfirmedSlot,
  rescheduleConfirmedSlots,
  confirmHeldSlot,
  emitBookingConfirmationUpdate,
  type GenerateSlotsOptions,
  type GenerateSlotsResult,
  type ListSlotsFilter,
  type HeldSlot,
  type GetAvailableSlotsFilter,
  type PublicAvailabilityFilter,
  type PublicAvailabilityBucket,
  type BlockSlotError,
  type BlockSlotResult,
  type ConfirmAvailableSlotResult,
  type ClaimSlotResult,
} from './slots.service.js';

export type { SlotStatus } from './slots.model.js';

// HTTP router, mounted under `/api/slots`.
export { default as slotsRouter } from './slots.routes.js';
