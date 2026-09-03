import { Router } from 'express';
import { getTenantsStatus } from './tenants.controller.js';
import { authenticate } from '../auth/authenticate.js';

const router = Router();

router.get('/status', authenticate ,getTenantsStatus);

export default router;