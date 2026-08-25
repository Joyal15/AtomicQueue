import { Router } from 'express';
import { getBookingsStatus } from './bookings.controller.js';

const router = Router();

router.get('/status', getBookingsStatus);

export default router;