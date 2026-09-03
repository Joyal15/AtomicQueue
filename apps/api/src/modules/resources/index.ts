/**
 * Public exports for the Resources module.
 *
 * Other modules should import resources functionality from this
 * barrel file rather than reaching into internal module files.
 */

export {
  createResource,
  getResources,
  getResourceById,
  updateResource,
  removeResource,
} from './resources.service.js';

/**
 * Resources HTTP router.
 *
 * This is imported by the main API routes file.
 */
export { default as resourcesRouter } from './resources.routes.js';