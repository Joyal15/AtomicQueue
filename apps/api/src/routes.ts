import { Router } from 'express';

import { authRouter, staffRouter} from './modules/auth/index.js';
import { tenantsRouter, publicBusinessRouter } from './modules/tenants/index.js';
import { bookingsRouter } from './modules/bookings/index.js';
import { servicesRouter } from './modules/services/index.js';
import { resourcesRouter } from './modules/resources/index.js';
import { providersRouter } from './modules/providers/index.js';
import {
  availabilityRouter,
  publicAvailabilityRouter,
  publicCatalogRouter,
} from './modules/availability/index.js';
import { slotsRouter } from './modules/slots/index.js';
import { waitlistRouter } from './modules/waitlist/index.js';

const router = Router();

router.use('/auth', authRouter);
router.use('/staff', staffRouter);
router.use('/tenants', tenantsRouter);
router.use('/bookings', bookingsRouter);
router.use('/services', servicesRouter);
router.use('/resources', resourcesRouter);
router.use('/providers', providersRouter);
router.use('/availability', availabilityRouter);
router.use('/slots', slotsRouter);
router.use('/waitlist', waitlistRouter);

// Owns its own path (/businesses/:slug/availability) rather than a
// prefix mount — see publicAvailability.routes.ts.
router.use(publicAvailabilityRouter);
router.use(publicCatalogRouter);
router.use(publicBusinessRouter);

export default router;