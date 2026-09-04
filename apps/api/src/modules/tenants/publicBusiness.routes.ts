import { Router } from 'express';

import { getPublicBusiness } from './publicBusiness.controller.js';

const router = Router();

router.get('/businesses/:slug', getPublicBusiness);

export default router;
