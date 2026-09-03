/**
 * Public surface of the Slots module. Other modules import from
 * here, not from `slots.model.ts` directly.
 */

export {
  generateWeeklySlots,
  listSlots,
  getAvailableSlots,
  blockSlot,
  type GenerateSlotsOptions,
  type GenerateSlotsResult,
  type ListSlotsFilter,
  type GetAvailableSlotsFilter,
  type BlockSlotError,
  type BlockSlotResult,
} from './slots.service.js';

export type { SlotStatus } from './slots.model.js';

// HTTP router, mounted under `/api/slots`.
export { default as slotsRouter } from './slots.routes.js';
