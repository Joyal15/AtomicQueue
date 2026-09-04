import { Router } from 'express';

import { authenticate } from '../auth/index.js';

import {
  joinWaitlistController,
  listWaitlistController,
} from './waitlist.controller.js';

const router = Router();

// Public — a customer opts in with no session (architecture doc §13a).
router.post('/', joinWaitlistController);

// Staff/owner dashboard view of their own business's waitlist.
router.get('/', authenticate, listWaitlistController);

export default router;
