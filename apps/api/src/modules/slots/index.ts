/**
 * Public surface of the Slots module.
 *
 * Other modules — Peter 1's future `bookings` module included — must
 * import from this barrel, never reach into `slots.model.ts` or the
 * service file directly. Deliberately NOT exported: `SlotModel` and
 * the raw Mongoose document type.
 */

export {
  generateWeeklySlots,
  listSlots,
  type GenerateSlotsOptions,
  type GenerateSlotsResult,
  type ListSlotsFilter,
} from './slots.service.js';

export type { SlotStatus } from './slots.model.js';

// HTTP router, mounted under `/api/slots` by the top-level routes barrel.
export { default as slotsRouter } from './slots.routes.js';
