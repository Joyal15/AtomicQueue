/**
 * Public surface of the Availability module.
 *
 * Other modules must import from this barrel only, never the model or
 * service files directly.
 *
 * Not exported: `ProviderAvailabilityModel` and the raw Mongoose document
 * types. Callers only see the shared API types.
 */

// Service-layer functions — the only way other modules read or write
// provider availability. `create*` / `update*` return a discriminated
// `AvailabilityWriteResult` so the caller can tell a bad service
// reference apart from a missing row.
export {
  createAvailability,
  getAvailability,
  getAvailabilityById,
  updateAvailability,
  removeAvailability,
  removeAvailabilityForProvider,
  removeAvailabilityForService,
  type AvailabilityWriteError,
  type AvailabilityWriteResult,
} from './availability.service.js';

// HTTP router, mounted under `/api/availability` by the top-level routes
// barrel.
export { default as availabilityRouter } from './availability.routes.js';

// Public (unauthenticated) availability router — owns its own top-level
// path (`/businesses/:slug/availability`), not nested under the mount
// above. See publicAvailability.routes.ts.
export { default as publicAvailabilityRouter } from './publicAvailability.routes.js';

// Public (unauthenticated) catalog router — service/provider name
// lookups a customer-facing booking page needs. See
// publicCatalog.routes.ts.
export { default as publicCatalogRouter } from './publicCatalog.routes.js';
