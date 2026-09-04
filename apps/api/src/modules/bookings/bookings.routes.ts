import { Router } from 'express';

import { authenticate } from '../auth/authenticate.js';

import {
  createBooking,
  getBookingsStatus,
  getBookings,
  createWalkInBookingController,
  exchangeMagicLinkController,
  resendMagicLinkController,
  getCustomerBookingController,
} from './bookings.controller.js';

import { requireBookingAccess } from './booking-access.js';

const bookingsRouter = Router();

bookingsRouter.get('/status', getBookingsStatus);

bookingsRouter.post(
  '/magic-link/exchange',
  exchangeMagicLinkController,
);

bookingsRouter.post(
  '/magic-link/resend',
  resendMagicLinkController,
);

bookingsRouter.get(
  '/manage',
  requireBookingAccess,
  getCustomerBookingController,
);

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