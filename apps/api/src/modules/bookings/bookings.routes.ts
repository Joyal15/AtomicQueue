import { Router } from 'express';

import { authenticate } from '../auth/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { requireAnyRole } from '../../lib/requireRole.js';

import {
  createBooking,
  getBookingsStatus,
  getBookings,
  createWalkInBookingController,
  exchangeMagicLinkController,
  resendMagicLinkController,
  getCustomerBookingController,
  cancelCustomerBookingController,
  cancelStaffBookingController,
  rescheduleCustomerBookingController,
  rescheduleStaffBookingController,
  updateBookingOutcomeController,
  createBookingSchema,
  exchangeMagicLinkSchema,
  resendMagicLinkSchema,
  rescheduleBookingSchema,
  bookingOutcomeSchema,
} from './bookings.controller.js';

import {
  requireBookingAccess,
  requireBookingManagement,
} from './booking-access.js';

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
  '/manage/cancel',
  requireBookingAccess,
  requireBookingManagement,
  cancelCustomerBookingController,
);

bookingsRouter.post(
  '/:bookingId/cancel',
  authenticate,
  requireAnyRole('owner', 'staff'),
  cancelStaffBookingController,
);

bookingsRouter.post(
  '/walk-in',
  authenticate,
  validate(createBookingSchema),
  createWalkInBookingController,
);

bookingsRouter.post(
  '/manage/reschedule',
  requireBookingAccess,
  requireBookingManagement,
  validate(rescheduleBookingSchema),
  rescheduleCustomerBookingController,
);

bookingsRouter.post(
  '/:bookingId/reschedule',
  authenticate,
  requireAnyRole('owner', 'staff'),
  validate(rescheduleBookingSchema),
  rescheduleStaffBookingController,
);

bookingsRouter.post(
  '/:bookingId/outcome',
  authenticate,
  requireAnyRole('owner', 'staff'),
  validate(bookingOutcomeSchema),
  updateBookingOutcomeController,
);

bookingsRouter.post(
  '/',
  authenticate,
  validate(createBookingSchema),
  createBooking,
);

bookingsRouter.get(
  '/',
  authenticate,
  getBookings,
);

export default bookingsRouter;
