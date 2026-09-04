import { Router } from 'express';

import { authenticate } from '../auth/authenticate.js';

import {
  createBooking,
  getBookingsStatus,
  getBookings,
  createWalkInBookingController,
} from './bookings.controller.js';

const bookingsRouter = Router();

bookingsRouter.get('/status', getBookingsStatus);

bookingsRouter.post(
  '/',
  authenticate,
  createBooking,
);

bookingsRouter.post(
  '/walk-in',
  authenticate,
  createWalkInBookingController,
);

bookingsRouter.get(
  '/',
  authenticate,
  getBookings,
);

export default bookingsRouter;