import { Router } from 'express';

import { authenticate } from '../auth/index.js';

import {
  createResourceController,
  getResourcesController,
  getResourceByIdController,
  updateResourceController,
  removeResourceController,
} from './resources.controller.js';

const router = Router();

/**
 * Every route below requires an authenticated session.
 */
router.use(authenticate);

// Create a new resource.
router.post('/', createResourceController);

// Get all resources for the authenticated business.
router.get('/', getResourcesController);

// Get one resource by ID.
router.get('/:resourceId', getResourceByIdController);

// Update an existing resource.
router.patch('/:resourceId', updateResourceController);

// Remove a resource by marking it as removed.
router.delete('/:resourceId', removeResourceController);

export default router;