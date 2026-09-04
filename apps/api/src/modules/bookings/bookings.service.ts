import { createHash, randomBytes } from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import { AppError } from '../../lib/Apperror.js';

import { redis } from '../../lib/redis.js';
import {
  claimSlot,
  confirmAvailableSlot,
  confirmHeldSlot,
  releaseHeldSlot,
  emitBookingConfirmationUpdate
} from '../slots/index.js';

import { BookingModel } from './bookings.model.js';

const HOLD_TTL_SECONDS = 300;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

type ProviderType = 'staff' | 'resource';
type ContactType = 'email' | 'phone';

export interface ConfirmBookingInput {
  businessId: string;
  providerId: string;
  providerType: ProviderType;
  serviceId: string;
  datetime: Date | string;

  customer: {
    name: string;
    contactType: ContactType;
    contact: string;
  };

  /**
   * null for customer self-service.
   * User id for staff/owner walk-ins.
   */
  createdBy: string | null;

  /**
   * Server-side authenticated session id.
   * Used to fence the Redis hold to the browser/session that created it.
   */
  sessionId: string;
}

export interface ConfirmBookingResult {
  bookingId: string;
  accessToken: string;
}

export interface BookingServiceDependencies {
  mongoSession?: ClientSession;
}

interface RedisHold {
  sessionId: string;
  holdVersion: string;
}

export interface BookingListItem {
  id: string;
  businessId: string;
  slotId: string;
  customer: {
    name: string;
    contactType: 'email' | 'phone';
    contact: string;
  };
  createdBy: string | null;
  status: 'confirmed' | 'cancelled' | 'completed' | 'no-show';
  accessTokenExpiresAt: string | null;
  noShowRiskNote: string | null;
  createdAt: string;
  cancelledAt: string | null;
}


export interface WalkInBookingInput {
  businessId: string;
  providerId: string;
  providerType: ProviderType;
  serviceId: string;
  datetime: Date | string;
  customer: {
    name: string;
    contactType: ContactType;
    contact: string;
  };
  createdBy: string;
}

function getHoldKey(slotId: string): string {
  return `hold:${slotId}`;
}

function hashAccessToken(token: string): string {
  return createHash('sha256')
    .update(token)
    .digest('hex');
}

function normalizeContact(
  contactType: ContactType,
  contact: string,
): string {
  const normalized = contact.trim();

  return contactType === 'email'
    ? normalized.toLowerCase()
    : normalized;
}

async function readRedisHold(
  slotId: string,
): Promise<RedisHold | null> {
  const value = await redis.get(getHoldKey(slotId));

  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('sessionId' in parsed) ||
      !('holdVersion' in parsed) ||
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.holdVersion !== 'string'
    ) {
      return null;
    }

    return {
      sessionId: parsed.sessionId,
      holdVersion: parsed.holdVersion,
    };
  } catch {
    return null;
  }
}

async function createRedisHold(
  slotId: string,
  sessionId: string,
  holdVersion: string,
): Promise<boolean> {
  const result = await redis.set(
    getHoldKey(slotId),
    JSON.stringify({
      sessionId,
      holdVersion,
    }),
    'EX',
    HOLD_TTL_SECONDS,
    'NX',
  );

  return result === 'OK';
}

/**
 * Deletes the Redis hold only if it still belongs to this exact
 * session + fencing token.
 *
 * This prevents one request from deleting a newer hold that reused
 * the same slot.
 */
async function deleteRedisHold(
  slotId: string,
  sessionId: string,
  holdVersion: string,
): Promise<void> {
  const key = getHoldKey(slotId);

  const current = await redis.get(key);

  if (!current) {
    return;
  }

  try {
    const parsed: unknown = JSON.parse(current);

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'sessionId' in parsed &&
      'holdVersion' in parsed &&
      parsed.sessionId === sessionId &&
      parsed.holdVersion === holdVersion
    ) {
      await redis.del(key);
    }
  } catch {
    // If the value is malformed, don't delete blindly.
    // TTL cleanup will remove it.
  }
}

/**
 * Claim an available Mongo slot and pair it with a Redis TTL hold.
 *
 * If claimSlot reports a held slot, we inspect Redis using the exact
 * Mongo fencing token. A missing/mismatched Redis hold means the Mongo
 * hold is stale, so we release it conditionally and retry once.
 */
async function claimAndHold(
  input: ConfirmBookingInput,
): Promise<{
  slotId: string;
  holdVersion: string;
}> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const claim = await claimSlot(
      input.businessId,
      input.providerId,
      input.providerType,
      input.serviceId,
      input.datetime,
    );

    if (claim.ok) {
      const redisHoldCreated = await createRedisHold(
        claim.slotId,
        input.sessionId,
        claim.holdVersion,
      );

      if (!redisHoldCreated) {
        /*
         * Mongo is already held. We deliberately do not perform an
         * unsafe compensating write here. The fencing token makes the
         * state recoverable by the normal stale-hold cleanup path.
         */
        throw new AppError(
          500,
          'SLOT_HOLD_FAILED',
          'Unable to hold the selected slot. Please try again.',
        );
      }

      return {
        slotId: claim.slotId,
        holdVersion: claim.holdVersion,
      };
    }

    if (claim.error === 'SLOT_NOT_AVAILABLE') {
      throw new AppError(
        409,
        'SLOT_NOT_AVAILABLE',
        'The selected slot is no longer available.',
      );
    }

    /*
     * SLOT_HELD:
     *
     * We only release the Mongo hold if Redis does NOT contain the
     * exact observed fencing token.
     */
    const redisHold = await readRedisHold(claim.slotId);

    if (
      redisHold &&
      redisHold.holdVersion === claim.holdVersion
    ) {
      throw new AppError(
        409,
        'SLOT_NOT_AVAILABLE',
        'The selected slot is no longer available.',
      );
    }

    await releaseHeldSlot(
      claim.slotId,
      claim.holdVersion,
    );
  }

  throw new AppError(
    409,
    'SLOT_NOT_AVAILABLE',
    'The selected slot is no longer available.',
  );
}

/**
 * Confirms a customer booking.
 *
 * External Redis operations happen outside the Mongo transaction.
 * The Mongo transaction only contains Mongo writes.
 */
export async function confirmBooking(
  input: ConfirmBookingInput,
  dependencies: BookingServiceDependencies = {},
): Promise<ConfirmBookingResult> {
  const { slotId, holdVersion } = await claimAndHold(input);

  /*
   * Verify the Redis hold before entering the transaction.
   *
   * This is deliberately NOT performed inside the Mongo transaction.
   */
  const hold = await readRedisHold(slotId);

  if (
    !hold ||
    hold.sessionId !== input.sessionId ||
    hold.holdVersion !== holdVersion
  ) {
    throw new AppError(
      409,
      'SLOT_HOLD_EXPIRED',
      'The slot hold has expired. Please select the slot again.',
    );
  }

  const rawAccessToken = randomBytes(32).toString('base64url');
  const accessTokenHash = hashAccessToken(rawAccessToken);
  const accessTokenExpiresAt = new Date(
    Date.now() + ACCESS_TOKEN_TTL_MS,
  );

  const session =
    dependencies.mongoSession ??
    await mongoose.startSession();

  const ownsSession = !dependencies.mongoSession;

  try {
    let bookingId = '';

    await session.withTransaction(async () => {
      /*
       * Slots owns SlotModel. Booking only calls the exported service
       * function and supplies the transaction session.
       */
      const confirmed = await confirmHeldSlot(
        slotId,
        input.businessId,
        holdVersion,
        session,
      );

      if (!confirmed) {
        throw new AppError(
          409,
          'SLOT_HOLD_EXPIRED',
          'The slot hold has expired. Please select the slot again.',
        );
      }

      const booking = await BookingModel.create(
        [
          {
            businessId: input.businessId,
            slotId,
            customer: {
              name: input.customer.name.trim(),
              contactType: input.customer.contactType,
              contact: normalizeContact(
                input.customer.contactType,
                input.customer.contact,
              ),
            },
            createdBy: input.createdBy,
            status: 'confirmed',
            accessTokenHash,
            accessTokenExpiresAt,
            noShowRiskNote: null,
            cancelledAt: null,
          },
        ],
        { session },
      );

      bookingId = String(booking[0]._id);
    });


    /*
     * Mongo committed successfully.
     */
    await emitBookingConfirmationUpdate(
      input.businessId,
      input.providerId,
      input.providerType,
      input.serviceId,
      input.datetime,
    );
    /*
     * Redis is now only cleanup. If this fails, the TTL will eventually
     * remove the hold, and the booking remains valid.
     */
    
    try {
      await deleteRedisHold(
        slotId,
        input.sessionId,
        holdVersion,
      );
    } catch {
      // Best effort. Never turn a committed booking into an error.
    }

    return {
      bookingId,
      accessToken: rawAccessToken,
    };
  } finally {
    if (ownsSession) {
      await session.endSession();
    }
  }
}


export async function createWalkInBooking(
  input: WalkInBookingInput,
): Promise<{ bookingId: string }> {
  const parsedDatetime = new Date(input.datetime);

  if (Number.isNaN(parsedDatetime.getTime())) {
    throw new AppError(
      400,
      'INVALID_REQUEST',
      'Invalid booking datetime.',
    );
  }

  const confirmedSlot = await confirmAvailableSlot(
    input.businessId,
    input.providerId,
    input.providerType,
    input.serviceId,
    parsedDatetime,
  );

  if (!confirmedSlot) {
    throw new AppError(
      409,
      'SLOT_NOT_AVAILABLE',
      'The selected slot is no longer available.',
    );
  }

  const booking = await BookingModel.create({
    businessId: input.businessId,
    slotId: confirmedSlot.slotId,
    customer: {
      name: input.customer.name.trim(),
      contactType: input.customer.contactType,
      contact: normalizeContact(
        input.customer.contactType,
        input.customer.contact,
      ),
    },
    createdBy: input.createdBy,
    status: 'confirmed',
    accessTokenHash: undefined,
    accessTokenExpiresAt: null,
    noShowRiskNote: null,
    cancelledAt: null,
  });

  return {
    bookingId: String(booking._id),
  };
}

export async function listBookings(
  businessId: string,
): Promise<BookingListItem[]> {
  const bookings = await BookingModel.find({
    businessId,
  })
    .sort({ createdAt: -1 })
    .lean();

  return bookings.map((booking) => ({
    id: String(booking._id),
    businessId: booking.businessId,
    slotId: booking.slotId,
    customer: {
      name: booking.customer.name,
      contactType: booking.customer.contactType,
      contact: booking.customer.contact,
    },
    createdBy: booking.createdBy,
    status: booking.status,
    accessTokenExpiresAt:
      booking.accessTokenExpiresAt?.toISOString() ?? null,
    noShowRiskNote: booking.noShowRiskNote,
    createdAt: booking.createdAt.toISOString(),
    cancelledAt: booking.cancelledAt?.toISOString() ?? null,
  }));
}