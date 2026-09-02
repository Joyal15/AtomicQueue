import { Router } from 'express';
import {
  getAuthStatus,
  signupOwnerController,
} from './auth.controller.js';

const router = Router();

router.get('/status', getAuthStatus);
router.post('/signup', signupOwnerController);

export default router;