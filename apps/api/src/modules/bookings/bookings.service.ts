import { createHash, randomBytes } from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import { AppError } from '../../lib/Apperror.js';

import { redis } from '../../lib/redis.js';
import {
  claimSlot,
  confirmAvailableSlot,
  confirmHeldSlot,
  releaseHeldSlot,
  cancelConfirmedSlot,
  rescheduleConfirmedSlots,
  emitBookingConfirmationUpdate,
  getSlotById,
} from '../slots/index.js';
import { notifyNextWaitlistEntry } from '../waitlist/index.js';

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

    // This slot just came back to 'available' via the stale-hold lazy
    // release — the "trigger on slot release" the waitlist module
    // needs (architecture doc §6/§13a). Best-effort, fire-and-forget:
    // never blocks or delays this loop's claim retry.
    void notifyNextWaitlistEntry(input.businessId, claim.slotId);
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

export interface CancelBookingResult {
  bookingId: string;
  slotId: string;
}

export async function cancelBooking(
  businessId: string,
  bookingId: string,
  dependencies: BookingServiceDependencies = {},
): Promise<CancelBookingResult> {
  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    throw new AppError(
      404,
      'BOOKING_NOT_FOUND',
      'Booking not found.',
    );
  }

  const session =
    dependencies.mongoSession ??
    await mongoose.startSession();

  const ownsSession = !dependencies.mongoSession;

  try {
    let cancelledSlotId = '';

    await session.withTransaction(async () => {
    const existingBooking = await BookingModel.findOne({
      _id: bookingId,
      businessId,
    })
      .select({ _id: 1, slotId: 1, status: 1 })
      .session(session)
      .lean();

    if (!existingBooking) {
      throw new AppError(
        404,
        'BOOKING_NOT_FOUND',
        'Booking not found.',
      );
    }

    if (existingBooking.status !== 'confirmed') {
      throw new AppError(
        409,
        'BOOKING_NOT_CANCELLABLE',
        'The booking is no longer cancellable.',
      );
    }

    const booking = await BookingModel.findOneAndUpdate(
      {
        _id: bookingId,
        businessId,
        status: 'confirmed',
      },
      {
        $set: {
          status: 'cancelled',
          cancelledAt: new Date(),
        },
      },
      {
        session,
        new: false,
      },
    )
      .select({ _id: 1, slotId: 1 })
      .lean();

    if (!booking) {
      throw new AppError(
        409,
        'BOOKING_NOT_CANCELLABLE',
        'The booking is no longer cancellable.',
      );
    }

    const released = await cancelConfirmedSlot(
      String(booking.slotId),
      businessId,
      session,
    );

    if (!released) {
      throw new AppError(
        409,
        'BOOKING_SLOT_CONFLICT',
        'The booking slot could not be released.',
      );
    }

    cancelledSlotId = String(booking.slotId);
    });

    /*
     * Mongo committed successfully.
     * Everything below is an external side effect.
     */
    const slot = await getSlotById(
      businessId,
      cancelledSlotId,
    );

    if (slot) {
      await emitBookingConfirmationUpdate(
        businessId,
        slot.providerId,
        slot.providerType,
        slot.serviceId,
        slot.datetime,
      );
    }

    /*
     * Waitlist notification is deliberately after commit.
     * The waitlist module owns matching/notification behavior.
     */
    void notifyNextWaitlistEntry(
      businessId,
      cancelledSlotId,
    );

    return {
      bookingId,
      slotId: cancelledSlotId,
    };
  } finally {
    if (ownsSession) {
      await session.endSession();
    }
  }
}

export interface RescheduleBookingInput {
  businessId: string;
  bookingId: string;
  providerId: string;
  providerType: ProviderType;
  serviceId: string;
  datetime: Date | string;
}

export interface RescheduleBookingResult {
  bookingId: string;
  oldSlotId: string;
  newSlotId: string;
  datetime: string;
}

export async function rescheduleBooking(
  input: RescheduleBookingInput,
  dependencies: BookingServiceDependencies = {},
): Promise<RescheduleBookingResult> {
  if (!mongoose.Types.ObjectId.isValid(input.bookingId)) {
    throw new AppError(
      404,
      'BOOKING_NOT_FOUND',
      'Booking not found.',
    );
  }

  const session =
    dependencies.mongoSession ??
    await mongoose.startSession();

  const ownsSession = !dependencies.mongoSession;

  try {
    const result = await session.withTransaction(
  async (): Promise<RescheduleBookingResult> => {
    const booking = await BookingModel.findOne({
      _id: input.bookingId,
      businessId: input.businessId,
    })
      .select({ _id: 1, slotId: 1, status: 1 })
      .session(session)
      .lean();

    if (!booking) {
      throw new AppError(
        404,
        'BOOKING_NOT_FOUND',
        'Booking not found.',
      );
    }

    if (booking.status !== 'confirmed') {
      throw new AppError(
        409,
        'BOOKING_NOT_RESCHEDULABLE',
        'The booking is no longer reschedulable.',
      );
    }

    const oldSlotId = String(booking.slotId);

    const slotResult = await rescheduleConfirmedSlots(
      input.businessId,
      oldSlotId,
      input.providerId,
      input.providerType,
      input.serviceId,
      input.datetime,
      session,
    );

    if (!slotResult) {
      throw new AppError(
        409,
        'SLOT_NOT_AVAILABLE',
        'The selected slot is no longer available.',
      );
    }

    const updatedBooking = await BookingModel.findOneAndUpdate(
      {
        _id: input.bookingId,
        businessId: input.businessId,
        status: 'confirmed',
        slotId: booking.slotId,
      },
      {
        $set: {
          slotId: slotResult.newSlotId,
        },
      },
      {
        session,
        new: true,
      },
    )
      .select({ _id: 1 })
      .lean();

    if (!updatedBooking) {
      throw new AppError(
        409,
        'BOOKING_NOT_RESCHEDULABLE',
        'The booking could not be rescheduled.',
      );
    }

    return {
      bookingId: input.bookingId,
      oldSlotId,
      newSlotId: slotResult.newSlotId,
      datetime: slotResult.newDatetime.toISOString(),
    };
  },
);

    /*
     * Mongo committed. Realtime updates happen only now.
     *
     * We emit the old and new buckets separately because the customer
     * availability view needs both sides of the move reflected.
     */
    const oldSlot = await getSlotById(
      input.businessId,
      result.oldSlotId,
    );

    if (oldSlot) {
      await emitBookingConfirmationUpdate(
        input.businessId,
        oldSlot.providerId,
        oldSlot.providerType,
        oldSlot.serviceId,
        oldSlot.datetime,
      );
    }

    await emitBookingConfirmationUpdate(
      input.businessId,
      input.providerId,
      input.providerType,
      input.serviceId,
      input.datetime,
    );

    void notifyNextWaitlistEntry(
      input.businessId,
      result.oldSlotId,
    );

    return result;

  } finally {

    if (ownsSession) {
      await session.endSession();
    }

  }
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

export async function getBookingForCustomer(
  bookingId: string,
): Promise<{
  booking: BookingListItem;
  slot: Awaited<ReturnType<typeof getSlotById>>;
}> {
  const booking = await BookingModel.findById(bookingId).lean();

  if (!booking) {
    throw new AppError(
      404,
      'BOOKING_NOT_FOUND',
      'Booking not found.',
    );
  }

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

  return {
    booking: {
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
    },
    slot,
  };
}