/**
 * HTTP router for the Availability module.
 *
 * Mounted at `/api/availability` by the top-level routes barrel. Just
 * wires paths to controller functions — no business logic here.
 *
 * Every route is business-scoped: controllers read `req.user.businessId`
 * from the session, never from the body or query. `authenticate` runs
 * first and populates `req.user`.
 */

import { Router } from 'express';

import { authenticate } from '../auth/index.js';
import { validate } from '../../middleware/validate.js';

import {
  createAvailabilityController,
  getAvailabilityController,
  getAvailabilityByIdController,
  updateAvailabilityController,
  removeAvailabilityController,
  createAvailabilitySchema,
  updateAvailabilitySchema,
} from './availability.controller.js';

const router = Router();

router.use(authenticate);

// POST /api/availability
// Create a new availability template for a provider + service.
router.post('/', validate(createAvailabilitySchema), createAvailabilityController);

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
router.patch('/:availabilityId', validate(updateAvailabilitySchema), updateAvailabilityController);

// DELETE /api/availability/:availabilityId
// Hard-delete the template (no soft-disable, unlike resources/services).
router.delete('/:availabilityId', removeAvailabilityController);

export default router;
