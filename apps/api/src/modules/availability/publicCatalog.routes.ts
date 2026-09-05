/**
 * Public (unauthenticated) catalog routes — same "owns its own
 * top-level path" shape as publicAvailability.routes.ts.
 */

import { Router } from 'express';

import { getPublicServices, getPublicProviders } from './publicCatalog.controller.js';

const router = Router();

router.get('/businesses/:slug/services', getPublicServices);
router.get('/businesses/:slug/providers', getPublicProviders);
export default router;
