/**
 * Public exports for the Services module.
 */

// HTTP router mounted by the main API router.
export { default as servicesRouter } from './services.routes.js';

// Service-layer functions for use by other modules.
export {
  createService,
  getServices,
  getServiceById,
  updateService,
  deactivateService,
  reactivateService,
} from './services.service.js';
