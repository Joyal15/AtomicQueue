import { Router } from 'express';
import { authRouter } from './modules/auth/index.js';
import { tenantsRouter } from './modules/tenants/index.js';
import { bookingsRouter } from './modules/bookings/index.js';

const router = Router();

router.use('/auth', authRouter);
router.use('/tenants', tenantsRouter);
router.use('/bookings', bookingsRouter);

export default router;
