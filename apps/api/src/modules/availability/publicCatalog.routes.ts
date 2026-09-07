/**
 * Public (unauthenticated) catalog routes — same "owns its own
 * top-level path" shape as publicAvailability.routes.ts.
 */

import { Router } from 'express';

import { rateLimit } from '../../lib/rateLimit.js';

import { getPublicServices, getPublicProviders } from './publicCatalog.controller.js';

const router = Router();

/**
 * Shares the `rl:public:discovery` per-IP bucket with the directory /
 * business-by-slug routes (`tenants/publicBusiness.routes.ts`) — same
 * generous, fail-open shape as the public availability limiter. A
 * booking page opening spends 1 request here for services + 1 for
 * providers; a human comparing businesses stays far under the window.
 */
const publicDiscoveryRateLimit = rateLimit({
  keyPrefix: 'rl:public:discovery',
  limit: 120,
  windowSeconds: 60,
  onRedisError: 'open',
});

router.get(
  '/businesses/:slug/services',
  publicDiscoveryRateLimit,
  getPublicServices,
);
router.get(
  '/businesses/:slug/providers',
  publicDiscoveryRateLimit,
  getPublicProviders,
);
export default router;
