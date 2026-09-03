/**
 * Public surface of the Availability module.
 *
 * Other modules must import from this barrel only — never reach
 * into `availability.model.ts`, `availability.service.ts`, etc.
 * directly. That rule is what keeps the module boundary real
 * (architecture doc Section 1, "Module boundary rule").
 *
 * Deliberately NOT exported: `ProviderAvailabilityModel` and the
 * raw Mongoose document types. Callers get the shared API types
 * back from the service functions and never see the DB shape.
 */

// Service-layer functions — the only way other modules read or
// write provider availability. `create*` / `update*` return a
// discriminated `AvailabilityWriteResult` so the caller can tell a
// bad service reference apart from a missing row.
export {
  createAvailability,
  getAvailability,
  getAvailabilityById,
  updateAvailability,
  removeAvailability,
  type AvailabilityWriteError,
  type AvailabilityWriteResult,
} from './availability.service.js';

// HTTP router, mounted under `/api/availability` by the top-level
// routes barrel.
export { default as availabilityRouter } from './availability.routes.js';
