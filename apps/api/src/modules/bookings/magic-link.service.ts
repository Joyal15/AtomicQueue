import { createHash, randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { AppError } from '../../lib/Apperror.js';
import { env } from '../../lib/env.js';
import { redis } from '../../lib/redis.js';
import { getSlotById } from '../slots/index.js';
import { sendEmail } from '../notifications/index.js';
import { BookingModel } from './bookings.model.js';

const MAGIC_LINK_COOKIE_NAME = 'booking_access';
// The exchanged session cookie is short-lived (§9a) — one hour.
const MAGIC_LINK_COOKIE_MAX_AGE_MS = 60 * 60 * 1000;
// The token/booking-level expiry is a DIFFERENT clock (§9a "two
// independent clocks"): anchored to the appointment, not creation, so a
// link for a far-future booking doesn't die before it happens.
const ACCESS_TOKEN_TTL_DAYS = 7;

function computeAccessTokenExpiry(slotDatetime: Date): Date {
  return new Date(
    slotDatetime.getTime() + ACCESS_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
}

const RESEND_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
const RESEND_RATE_LIMIT_MAX_ATTEMPTS = 3;

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

/**
 * Throws the identical error whether the token doesn't exist or has
 * expired — enumeration resistance (architecture doc §13a: "404
 * generic for invalid/expired"). A distinguishable response here
 * would let an untrusted caller learn a token/bookingId pair was once
 * valid just by watching the status code flip from 404 to something
 * else once it expires.
 */
export async function findBookingByMagicLinkToken(
  token: string,
) {
  const tokenHash = hashMagicLinkToken(token);

  const booking = await BookingModel.findOne({
    accessTokenHash: tokenHash,
  }).lean();

  if (
    !booking ||
    !booking.accessTokenExpiresAt ||
    booking.accessTokenExpiresAt.getTime() <= Date.now()
  ) {
    throw new AppError(
      404,
      'BOOKING_NOT_FOUND',
      'Booking not found.',
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

/**
 * Independent per-key Redis rate limit (one call per key you want to
 * bound — the resend controller calls this once for the caller's IP
 * and once for the submitted contact, per architecture doc §13a's
 * IP+contact rate limiting). Redis's own INCR is atomic, so this is
 * race-safe without extra locking.
 */
async function isWithinResendRateLimit(key: string): Promise<boolean> {
  const redisKey = `magic-link-resend:${key}`;
  const count = await redis.incr(redisKey);

  if (count === 1) {
    await redis.expire(redisKey, RESEND_RATE_LIMIT_WINDOW_SECONDS);
  }

  return count <= RESEND_RATE_LIMIT_MAX_ATTEMPTS;
}

/**
 * Checks both the caller's IP and the submitted contact against the
 * resend rate limit. Safe to expose whether this failed (a 429 is
 * returned identically regardless of whether the contact actually
 * matches a booking, per §9/§13a) — unlike a lookup result, "you're
 * rate limited" never reveals whether the target contact exists.
 */
export async function checkResendRateLimit(
  ip: string,
  contact: string,
): Promise<boolean> {
  const [withinIpLimit, withinContactLimit] = await Promise.all([
    isWithinResendRateLimit(`ip:${ip}`),
    isWithinResendRateLimit(`contact:${contact.trim().toLowerCase()}`),
  ]);

  return withinIpLimit && withinContactLimit;
}

/**
 * Resends a magic-link for the soonest upcoming confirmed booking
 * matching a customer contact — the customer doesn't need to remember
 * a bookingId, just the email/phone they booked with (architecture
 * doc §9a/§13a). Rotates a fresh token (the raw value is never
 * stored, so there's no original to resend) and emails it.
 *
 * Deliberately silent on "no match": never throws for that case, and
 * the caller (resendMagicLinkController) always returns the same
 * neutral response regardless of whether this found anything —
 * enumeration resistance.
 */
export async function resendMagicLink(contact: string): Promise<void> {
  const normalizedContact = contact.trim().toLowerCase();
  if (!normalizedContact) return;

  const candidates = await BookingModel.find({
    'customer.contact': normalizedContact,
    status: 'confirmed',
  }).lean();

  if (candidates.length === 0) return;

  let soonest: { booking: (typeof candidates)[number]; datetime: Date } | null =
    null;

  for (const booking of candidates) {
    const slot = await getSlotById(booking.businessId, booking.slotId);
    if (!slot) continue;

    const datetime = new Date(slot.datetime);
    if (datetime.getTime() <= Date.now()) continue; // not upcoming

    if (!soonest || datetime < soonest.datetime) {
      soonest = { booking, datetime };
    }
  }

  if (!soonest) return;

  const rawAccessToken = randomBytes(32).toString('base64url');
  const accessTokenHash = hashMagicLinkToken(rawAccessToken);
  const accessTokenExpiresAt = computeAccessTokenExpiry(soonest.datetime);

  await BookingModel.updateOne(
    { _id: soonest.booking._id },
    { $set: { accessTokenHash, accessTokenExpiresAt } },
  );

  const manageUrl = `${env.FRONTEND_URL}/manage?bookingId=${String(soonest.booking._id)}&token=${rawAccessToken}`;

  await sendEmail({
    to: soonest.booking.customer.contact,
    subject: 'Your booking management link',
    text: `Here is your link to manage your booking: ${manageUrl}`,
  });
}