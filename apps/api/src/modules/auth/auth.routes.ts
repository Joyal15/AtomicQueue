import { Router } from 'express';
import {
  getAuthStatus,
  signupOwnerController,
  loginController,
  logoutController,
  logoutEverywhereController,
  signupSchema,
  loginSchema,
} from './auth.controller.js';

import { authenticate } from './authenticate.js';
import { validate } from '../../middleware/validate.js';
import { rateLimit } from '../../lib/rateLimit.js';

const router = Router();

/**
 * Per-IP cap on the one public unauthenticated *write* on the auth
 * surface. `login` is already bounded by its own per-account / per-IP
 * failure limits (auth.rateLimit.ts); `signup` had nothing, so a script
 * could create businesses + owner users unbounded. Generous enough that
 * a real person (or a workshop behind one NAT) never notices; fails open
 * so a Redis blip can't block legitimate signups.
 */
const signupRateLimit = rateLimit({
  keyPrefix: 'rl:auth:signup',
  limit: 10,
  windowSeconds: 60,
  onRedisError: 'open',
});

router.get('/status', getAuthStatus);
router.post('/signup', signupRateLimit, validate(signupSchema), signupOwnerController);
router.post('/login', validate(loginSchema), loginController);
router.post('/logout', authenticate, logoutController);
router.post('/logout-everywhere', authenticate, logoutEverywhereController);

export default router;