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
 * Service routes.
 *
 * These routes define the HTTP interface for managing services.
 * Every route requires an authenticated session — `authenticate`
 * (the `auth` module) populates `req.user` from a fresh Mongo read
 * before any controller here runs; `requireUser` in each controller
 * is the type-level/defensive backstop, not a substitute for this.
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