import { Router } from 'express';

import { authenticate } from '../auth/index.js';

import {
  createServiceController,
  getServicesController,
  getServiceByIdController,
  updateServiceController,
  deactivateServiceController,
} from './services.controller.js';

const router = Router();

/**
 * Every route below requires an authenticated session.
 */
router.use(authenticate);

// Create a new service.
router.post('/', createServiceController);

// Get all services for a business.
router.get('/', getServicesController);

// Get one service by ID.
router.get('/:serviceId', getServiceByIdController);

// Update an existing service.
router.patch('/:serviceId',updateServiceController);

// Deactivate an existing service.
router.delete('/:serviceId', deactivateServiceController);

export default router;