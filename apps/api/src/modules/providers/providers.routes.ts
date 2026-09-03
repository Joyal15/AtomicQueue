/**
 * HTTP router for the Providers module.
 *
 * Mounted at `/api/providers` by the top-level routes barrel.
 *
 * Read-only by design. "Provider" has no collection of its own, so there
 * is nothing to create, update, or delete here — staff onboarding lives
 * in the staff invitation flow, resource create/retire in the
 * `resources` module, and availability templates in the `availability`
 * module. This router only exposes the unified read over those.
 *
 * `authenticate` runs first and populates `req.user`.
 */

import { Router } from 'express';

import { authenticate } from '../auth/index.js';

import { listProvidersController } from './providers.controller.js';

const router = Router();

router.use(authenticate);

// GET /api/providers?type=staff|resource&includeRemoved=true
// Unified list of the business's staff + resource providers.
router.get('/', listProvidersController);

export default router;
