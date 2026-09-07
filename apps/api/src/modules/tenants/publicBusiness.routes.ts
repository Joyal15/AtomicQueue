import { Router } from 'express';

import { rateLimit } from '../../lib/rateLimit.js';

import {
  getPublicBusiness,
  getPublicBusinesses,
} from './publicBusiness.controller.js';

const router = Router();

/**
 * Per-IP limit for the unauthenticated discovery surface — the directory
 * list, the single-business lookup, and (same key, same bucket) the
 * public service/provider catalog. Same generous, fail-open shape as the
 * public availability limiter (`publicAvailability.routes.ts`): a human
 * browsing and searching stays far under it; it only blunts scripted
 * enumeration of the directory, which is the heaviest public read — a
 * cross-tenant aggregate plus a name search on every call.
 *
 * The public catalog routes (`availability/publicCatalog.routes.ts`)
 * declare their own limiter with this same `keyPrefix`, so all four
 * discovery reads share one per-IP bucket.
 */
const publicDiscoveryRateLimit = rateLimit({
  keyPrefix: 'rl:public:discovery',
  limit: 120,
  windowSeconds: 60,
  onRedisError: 'open',
});

// Public customer discovery — list businesses taking bookings.
router.get('/businesses', publicDiscoveryRateLimit, getPublicBusinesses);

// Public single-business lookup by slug.
router.get('/businesses/:slug', publicDiscoveryRateLimit, getPublicBusiness);

export default router;
