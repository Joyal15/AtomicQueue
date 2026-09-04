import type { RequestHandler } from 'express';

import { AppError } from '../../lib/Apperror.js';
import { getBusinessById } from '../tenants/index.js';
import { getSlotById } from '../slots/index.js';
import {
  exchangeMagicLink,
  getBookingAccessCookie,
} from './magic-link.service.js';

export type BookingAccessTier = 'manage' | 'view-only';

export interface BookingAccessContext {
  bookingId: string;
  tier: BookingAccessTier;
}

declare global {
  namespace Express {
    interface Request {
      bookingAccess?: BookingAccessContext;
    }
  }
}

export const requireBookingAccess: RequestHandler = async (
  req,
  _res,
  next,
) => {
  try {
    const parsed = getBookingAccessCookie(
      req.cookies?.booking_access,
    );

    if (!parsed) {
      throw new AppError(
        401,
        'BOOKING_ACCESS_REQUIRED',
        'Booking access is required.',
      );
    }

    const booking = await exchangeMagicLink(
      parsed.bookingId,
      parsed.token,
    );

    const slot = await getSlotById(
      booking.businessId,
      booking.slotId,
    );

    if (!slot) {
      throw new AppError(
        404,
        'BOOKING_NOT_FOUND',
        'Booking not found.',
      );
    }

    const business = await getBusinessById(
      booking.businessId,
    );

    if (!business) {
      throw new AppError(
        404,
        'BOOKING_NOT_FOUND',
        'Booking not found.',
      );
    }

    const now = Date.now();

    if (
      !booking.accessTokenExpiresAt ||
      booking.accessTokenExpiresAt.getTime() <= now
    ) {
      throw new AppError(
        401,
        'MAGIC_LINK_EXPIRED',
        'This booking link has expired.',
      );
    }

    const cutoffAt =
      slot.datetime
        ? new Date(
            new Date(slot.datetime).getTime() -
              business.cancellationCutoffMinutes * 60 * 1000,
          ).getTime()
        : 0;

    req.bookingAccess = {
      bookingId: String(booking._id),
      tier:
        now < cutoffAt
          ? 'manage'
          : 'view-only',
    };

    next();
  } catch (error) {
    next(error);
  }
};

export const requireBookingManagement: RequestHandler = async (
  req,
  _res,
  next,
) => {
  try {
    if (!req.bookingAccess) {
      throw new AppError(
        401,
        'BOOKING_ACCESS_REQUIRED',
        'Booking access is required.',
      );
    }

    if (req.bookingAccess.tier !== 'manage') {
      throw new AppError(
        403,
        'BOOKING_MANAGEMENT_CLOSED',
        'Booking management is no longer available.',
      );
    }

    next();
  } catch (error) {
    next(error);
  }
};