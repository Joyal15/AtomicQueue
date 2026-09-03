import { Router } from 'express';
import {
  getAuthStatus,
  signupOwnerController,
  loginController,
} from './auth.controller.js';

const router = Router();

router.get('/status', getAuthStatus);
router.post('/signup', signupOwnerController);
router.post('/login', loginController);

export default router;