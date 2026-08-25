import { Router } from 'express';
import { getTenantsStatus } from './tenants.controller.js';

const router = Router();

router.get('/status', getTenantsStatus);

export default router;