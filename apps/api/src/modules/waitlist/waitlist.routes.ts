import { Router } from 'express';

import { authenticate } from '../auth/index.js';
import { validate } from '../../middleware/validate.js';

import {
  joinWaitlistController,
  listWaitlistController,
  joinWaitlistSchema,
} from './waitlist.controller.js';

const router = Router();

// Public — a customer opts in with no session (architecture doc §13a).
router.post('/', validate(joinWaitlistSchema), joinWaitlistController);

// Staff/owner dashboard view of their own business's waitlist.
router.get('/', authenticate, listWaitlistController);

export default router;
