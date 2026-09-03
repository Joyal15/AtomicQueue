/**
 * Public exports for the Services module.
 *
 * Other backend modules should import service functionality
 * from this file instead of accessing services.model.ts directly.
 */

// Export the HTTP router so the main API router can mount
// the Services endpoints.
export { default as servicesRouter } from './services.routes.js';

// Export service-layer functions for use by other modules.
export {
  createService,
  getServices,
  getServiceById,
  updateService,
  deactivateService,
} from './services.service.js';