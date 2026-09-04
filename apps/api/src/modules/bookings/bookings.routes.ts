import { Router } from 'express';

import { authenticate } from '../auth/authenticate.js';
import { validate } from '../../middleware/validate.js';

import {
  createBooking,
  getBookingsStatus,
  getBookings,
  createWalkInBookingController,
  exchangeMagicLinkController,
  resendMagicLinkController,
  getCustomerBookingController,
  createBookingSchema,
  exchangeMagicLinkSchema,
  resendMagicLinkSchema,
} from './bookings.controller.js';

import { requireBookingAccess } from './booking-access.js';

const bookingsRouter = Router();

bookingsRouter.get('/status', getBookingsStatus);

bookingsRouter.post(
  '/magic-link/exchange',
  validate(exchangeMagicLinkSchema),
  exchangeMagicLinkController,
);

bookingsRouter.post(
  '/magic-link/resend',
  validate(resendMagicLinkSchema),
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
  validate(createBookingSchema),
  createBooking,
);

bookingsRouter.post(
  '/walk-in',
  authenticate,
  validate(createBookingSchema),
  createWalkInBookingController,
);

bookingsRouter.get(
  '/',
  authenticate,
  getBookings,
);

export default bookingsRouter;
