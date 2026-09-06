import { Router } from 'express';

import { authenticate } from '../auth/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { requireAnyRole } from '../../lib/requireRole.js';
import { rateLimit } from '../../lib/rateLimit.js';

/**
 * Per-IP limiter for the anonymous booking surface (architecture doc
 * §13's "add rate limiting on the public booking endpoint"). Generous
 * enough that a real customer clicking around never notices; tight
 * enough to blunt scripted slot-scraping / hold-spamming. Fails open —
 * anonymous booking staying available matters more than a hard Redis
 * dependency for it.
 */
const publicBookingRateLimit = rateLimit({
  keyPrefix: 'rl:bookings:public',
  limit: 40,
  windowSeconds: 60,
  onRedisError: 'open',
});

import {
  createBooking,
  getBookingsStatus,
  getBookings,
  createWalkInBookingController,
  holdCustomerBookingController,
  confirmCustomerBookingController,
  exchangeMagicLinkController,
  resendMagicLinkController,
  getCustomerBookingController,
  cancelCustomerBookingController,
  cancelStaffBookingController,
  rescheduleCustomerBookingController,
  rescheduleStaffBookingController,
  updateBookingOutcomeController,
  createBookingSchema,
  holdCustomerBookingSchema,
  confirmCustomerBookingSchema,
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

// Anonymous customer booking (architecture doc §13a) — no session, the
// browser-generated sessionId in the body fences the Redis hold.
bookingsRouter.post(
  '/hold',
  publicBookingRateLimit,
  validate(holdCustomerBookingSchema),
  holdCustomerBookingController,
);

bookingsRouter.post(
  '/confirm',
  publicBookingRateLimit,
  validate(confirmCustomerBookingSchema),
  confirmCustomerBookingController,
);

bookingsRouter.post(
  '/magic-link/exchange',
  publicBookingRateLimit,
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
