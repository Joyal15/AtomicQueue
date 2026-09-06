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

const router = Router();

router.get('/status', getAuthStatus);
router.post('/signup', validate(signupSchema), signupOwnerController);
router.post('/login', validate(loginSchema), loginController);
router.post('/logout', authenticate, logoutController);
router.post('/logout-everywhere', authenticate, logoutEverywhereController);

export default router;