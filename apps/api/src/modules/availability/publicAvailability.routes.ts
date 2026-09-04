/**
 * Public (unauthenticated) availability route.
 *
 * Deliberately has no `router.use(authenticate)` — unlike every other
 * router in this module — and owns its own top-level path
 * (`/businesses/:slug/availability`) rather than nesting under
 * `/api/availability`, matching architecture doc §13a's route table
 * exactly. Mounted directly (not under a path prefix) by the
 * top-level routes barrel.
 */

import { Router } from 'express';

import { getPublicAvailability } from './publicAvailability.controller.js';

const router = Router();

router.get('/businesses/:slug/availability', getPublicAvailability);

export default router;
