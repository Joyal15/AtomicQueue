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

import { rateLimit } from '../../lib/rateLimit.js';

import { getPublicAvailability } from './publicAvailability.controller.js';

const router = Router();

// Public browse view — per-IP limited to blunt scripted scraping of a
// tenant's whole schedule. Generous (a customer paging through days
// stays well under it) and fails open.
router.get(
  '/businesses/:slug/availability',
  rateLimit({
    keyPrefix: 'rl:public:availability',
    limit: 120,
    windowSeconds: 60,
    onRedisError: 'open',
  }),
  getPublicAvailability,
);

export default router;
