import { Router } from 'express';

import { authenticate } from '../auth/index.js';
import { validate } from '../../middleware/validate.js';

import {
  createResourceController,
  getResourcesController,
  getResourceByIdController,
  updateResourceController,
  removeResourceController,
  retireResourceController,
  reactivateResourceController,
  createResourceSchema,
  updateResourceSchema,
} from './resources.controller.js';

const router = Router();

/**
 * Every route below requires an authenticated session.
 */
router.use(authenticate);

// Create a new resource.
router.post('/', validate(createResourceSchema), createResourceController);

// Get all resources for the authenticated business.
router.get('/', getResourcesController);

// Get one resource by ID.
router.get('/:resourceId', getResourceByIdController);

// Retire a resource (transactional cascade — architecture doc §9c).
router.patch('/:resourceId/retire', retireResourceController);

// Reactivate a previously retired resource.
router.patch('/:resourceId/reactivate', reactivateResourceController);

// Update an existing resource.
router.patch('/:resourceId', validate(updateResourceSchema), updateResourceController);

// Remove a resource by marking it as removed (same cascade as .../retire).
router.delete('/:resourceId', removeResourceController);

export default router;
