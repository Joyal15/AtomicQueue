import { Router } from 'express';

import {
  getPublicBusiness,
  getPublicBusinesses,
} from './publicBusiness.controller.js';

const router = Router();

// Public customer discovery — list businesses taking bookings.
router.get('/businesses', getPublicBusinesses);

// Public single-business lookup by slug.
router.get('/businesses/:slug', getPublicBusiness);

export default router;
