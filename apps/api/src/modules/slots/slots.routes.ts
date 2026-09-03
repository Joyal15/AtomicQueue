import { Router } from 'express';

import { authenticate } from '../auth/index.js';
import { validate } from '../../middleware/validate.js';

import {
  blockSlotController,
  generateSlotsController,
  generateSlotsSchema,
  listSlotsController,
} from './slots.controller.js';

const router = Router();

router.use(authenticate);

// POST /api/slots/generate — owner-only. Generates slots for the caller's business.
router.post(
  '/generate',
  validate(generateSlotsSchema),
  generateSlotsController,
);

// GET /api/slots — any authenticated staff/owner.
router.get('/', listSlotsController);

// POST /api/slots/:slotId/block — any authenticated staff/owner.
// 404 if missing/cross-tenant, 409 if not currently available.
router.post('/:slotId/block', blockSlotController);

export default router;
