/**
 * Public exports for the Resources module.
 */

export {
  createResource,
  getResources,
  getResourceById,
  updateResource,
  removeResource,
  retireResource,
  reactivateResource,
} from './resources.service.js';

/**
 * Resources HTTP router, mounted by the main API routes file.
 */
export { default as resourcesRouter } from './resources.routes.js';