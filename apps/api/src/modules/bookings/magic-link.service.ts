import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { AppError } from '../../lib/Apperror.js';
import { BookingModel } from './bookings.model.js';

const MAGIC_LINK_COOKIE_NAME = 'booking_access';
const MAGIC_LINK_COOKIE_MAX_AGE_MS = 60 * 60 * 1000;

export function setBookingAccessCookie(
  res: Response,
  bookingId: string,
  token: string,
): void {
  res.cookie(
    MAGIC_LINK_COOKIE_NAME,
    `${bookingId}.${token}`,
    {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: MAGIC_LINK_COOKIE_MAX_AGE_MS,
      path: '/api/bookings',
    },
  );
}

export function getBookingAccessCookie(
  cookieValue: string | undefined,
): {
  bookingId: string;
  token: string;
} | null {
  if (!cookieValue) {
    return null;
  }

  const separatorIndex = cookieValue.indexOf('.');

  if (separatorIndex <= 0 || separatorIndex === cookieValue.length - 1) {
    return null;
  }

  return {
    bookingId: cookieValue.slice(0, separatorIndex),
    token: cookieValue.slice(separatorIndex + 1),
  };
}

export function hashMagicLinkToken(token: string): string {
  return createHash('sha256')
    .update(token)
    .digest('hex');
}

export async function findBookingByMagicLinkToken(
  token: string,
) {
  const tokenHash = hashMagicLinkToken(token);

  const booking = await BookingModel.findOne({
    accessTokenHash: tokenHash,
  }).lean();

  if (!booking) {
    throw new AppError(
      404,
      'BOOKING_NOT_FOUND',
      'Booking not found.',
    );
  }

  if (
    !booking.accessTokenExpiresAt ||
    booking.accessTokenExpiresAt.getTime() <= Date.now()
  ) {
    throw new AppError(
      401,
      'MAGIC_LINK_EXPIRED',
      'This booking link has expired.',
    );
  }

  return booking;
}

export async function exchangeMagicLink(
  bookingId: string,
  token: string,
) {
  const booking = await findBookingByMagicLinkToken(token);

  if (String(booking._id) !== bookingId) {
    throw new AppError(
      404,
      'BOOKING_NOT_FOUND',
      'Booking not found.',
    );
  }

  return booking;
}