/**
 * HTTP router for the Providers module.
 *
 * Mounted at `/api/providers` by the top-level routes barrel
 * (`apps/api/src/routes.ts`).
 *
 * Read-only by design. "Provider" has no collection of its own
 * (see `providers.model.ts`), so there is nothing to create, update
 * or delete here:
 *   - staff onboarding/removal lives in the staff invitation flow
 *     (architecture doc Section 9b),
 *   - resource create/retire lives in the `resources` module
 *     (Section 9c),
 *   - weekly availability templates live in the `availability`
 *     module.
 * This router only exposes the unified read over those.
 *
 * `authenticate` (the `auth` module) is mounted below and populates
 * `req.user` from a fresh Mongo read before the controller runs.
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
