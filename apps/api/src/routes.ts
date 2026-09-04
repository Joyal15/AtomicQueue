import { Router } from 'express';

import { authRouter, staffRouter} from './modules/auth/index.js';
import { tenantsRouter } from './modules/tenants/index.js';
import { bookingsRouter } from './modules/bookings/index.js';
import { servicesRouter } from './modules/services/index.js';
import { resourcesRouter } from './modules/resources/index.js';
import { providersRouter } from './modules/providers/index.js';
import {
  availabilityRouter,
  publicAvailabilityRouter,
} from './modules/availability/index.js';
import { slotsRouter } from './modules/slots/index.js';

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

// Owns its own path (/businesses/:slug/availability) rather than a
// prefix mount — see publicAvailability.routes.ts.
router.use(publicAvailabilityRouter);

export default router;