import { Router } from 'express';

import { authenticate } from '../auth/index.js';
import { validate } from '../../middleware/validate.js';

import {
  generateSlotsController,
  generateSlotsSchema,
  listSlotsController,
} from './slots.controller.js';

const router = Router();

router.use(authenticate);

// POST /api/slots/generate — owner-only. Runs generate-weekly-slots
// (architecture doc Section 6) for the caller's own business.
router.post(
  '/generate',
  validate(generateSlotsSchema),
  generateSlotsController,
);

// GET /api/slots — any authenticated staff/owner. Verification aid
// for this module today; a head start for the future dashboard/
// public booking-page slot list.
router.get('/', listSlotsController);

export default router;
