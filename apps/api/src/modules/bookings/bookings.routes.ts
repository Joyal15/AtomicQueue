import { Router } from 'express';

import { authenticate } from '../auth/authenticate.js';

import {
  createBooking,
  getBookingsStatus,
} from './bookings.controller.js';

const bookingsRouter = Router();

bookingsRouter.get('/status', getBookingsStatus);

bookingsRouter.post(
  '/',
  authenticate,
  createBooking,
);

export default bookingsRouter;