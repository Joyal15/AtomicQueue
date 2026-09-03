/**
 * HTTP router for the Availability module.
 *
 * Mounted at `/api/availability` by the top-level routes barrel
 * (`apps/api/src/routes.ts`). This file only wires paths to
 * controller functions — no business logic lives here.
 *
 * Every route is business-scoped: the controllers read
 * `req.user.businessId` from the authenticated session and never
 * trust a businessId from the body or query. `authenticate` (the
 * `auth` module) is mounted below and populates `req.user` from a
 * fresh Mongo read before any controller here runs.
 */

import { Router } from 'express';

import { authenticate } from '../auth/index.js';

import {
  createAvailabilityController,
  getAvailabilityController,
  getAvailabilityByIdController,
  updateAvailabilityController,
  removeAvailabilityController,
} from './availability.controller.js';

const router = Router();

router.use(authenticate);

// POST /api/availability
// Create a new availability template for a provider + service.
router.post('/', createAvailabilityController);

// GET /api/availability?providerId=&serviceId=
// List the authenticated business's templates, optionally filtered
// by provider and/or service.
router.get('/', getAvailabilityController);

// GET /api/availability/:availabilityId
// Fetch one template; 404 if it isn't owned by this business.
router.get('/:availabilityId', getAvailabilityByIdController);

// PATCH /api/availability/:availabilityId
// Partial update — currently the serviceId and weeklyWindows.
// Repointing serviceId re-runs the same-business + active check.
router.patch('/:availabilityId', updateAvailabilityController);

// DELETE /api/availability/:availabilityId
// Hard-delete the template. Templates carry no historical value,
// so unlike resources/services there is no soft-disable here.
router.delete('/:availabilityId', removeAvailabilityController);

export default router;
