import { Router } from 'express';

import { authenticate } from '../auth/index.js';
import { validate } from '../../middleware/validate.js';

import {
  createServiceController,
  getServicesController,
  getServiceByIdController,
  updateServiceController,
  deactivateServiceController,
  createServiceSchema,
  updateServiceSchema,
} from './services.controller.js';

const router = Router();

/**
 * Every route below requires an authenticated session.
 */
router.use(authenticate);

// Create a new service.
router.post('/', validate(createServiceSchema), createServiceController);

// Get all services for a business.
router.get('/', getServicesController);

// Get one service by ID.
router.get('/:serviceId', getServiceByIdController);

// Update an existing service.
router.patch('/:serviceId', validate(updateServiceSchema), updateServiceController);

// Deactivate an existing service.
router.delete('/:serviceId', deactivateServiceController);

export default router;
