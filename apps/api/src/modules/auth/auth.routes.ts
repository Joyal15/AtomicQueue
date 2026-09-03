import { Router } from 'express';
import {
  getAuthStatus,
  signupOwnerController,
  loginController,
  logoutController,
  logoutEverywhereController,
} from './auth.controller.js';

import { authenticate } from './authenticate.js';

const router = Router();

router.get('/status', getAuthStatus);
router.post('/signup', signupOwnerController);
router.post('/login', loginController);
router.post('/logout', authenticate, logoutController);
router.post('/logout-everywhere', authenticate, logoutEverywhereController);

export default router;