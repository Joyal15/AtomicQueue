import { Router } from 'express';

import { authenticate } from '../auth/index.js';
import { validate } from '../../middleware/validate.js';
import { rateLimit } from '../../lib/rateLimit.js';

import {
  joinWaitlistController,
  listWaitlistController,
  joinWaitlistSchema,
} from './waitlist.controller.js';

const router = Router();

// Public — a customer opts in with no session (architecture doc §13a).
// Per-IP limited like the rest of the anonymous booking surface.
router.post(
  '/',
  rateLimit({
    keyPrefix: 'rl:waitlist:join',
    limit: 15,
    windowSeconds: 60,
    onRedisError: 'open',
  }),
  validate(joinWaitlistSchema),
  joinWaitlistController,
);

// Staff/owner dashboard view of their own business's waitlist.
router.get('/', authenticate, listWaitlistController);

export default router;
