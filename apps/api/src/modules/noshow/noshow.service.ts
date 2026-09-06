import mongoose from 'mongoose';

import { logger } from '../../lib/logger.js';
import { jobsQueue } from '../../lib/queue.js';
import {
  getBookingScoringContext,
  getCustomerBookingStats,
  persistNoShowRiskNote,
} from '../bookings/bookings.service.js';
import { getSlotById } from '../slots/index.js';

import { generateRiskNote } from './gemini.client.js';

/**
 * Job name on the shared `queueless-jobs` queue. Local literal, matching
 * how `worker.ts` / `notifications.service.ts` / `waitlist.service.ts`
 * already agree on job names by duplicated string rather than a shared
 * constants import. `worker.ts`'s handler switch must use this exact
 * string.
 */
export const SCORE_NO_SHOW_RISK_JOB = 'score-no-show-risk';

interface ScoreNoShowRiskJobData {
  bookingId: string;
}

/**
 * Enqueues no-show risk scoring for a freshly-confirmed booking
 * (architecture doc §10). Called strictly AFTER the booking transaction
 * commits, fire-and-forget — the confirming HTTP request never waits on
 * Gemini, and a failure to even enqueue must never turn a committed
 * booking into an error.
 *
 * `removeOnComplete`/`removeOnFail` both set: there is deliberately no
 * retry/backfill for a booking that misses scoring due to a transient
 * outage (§10), so a failed job is discarded, not parked. Rate-limited
 * to one computation per booking creation by construction — this is the
 * only place it's enqueued, and the write itself is compute-once.
 */
export async function enqueueNoShowScoring(
  bookingId: string,
): Promise<void> {
  await jobsQueue.add(
    SCORE_NO_SHOW_RISK_JOB,
    { bookingId } satisfies ScoreNoShowRiskJobData,
    { removeOnComplete: true, removeOnFail: true },
  );
}

function buildPrompt(input: {
  totalPast: number;
  completedCount: number;
  cancelledCount: number;
  noShowCount: number;
  leadTimeHours: number | null;
}): string {
  const history =
    input.totalPast === 0
      ? 'This is the first booking on record for this customer at this business.'
      : [
          `Prior bookings at this business: ${input.totalPast}.`,
          `Completed: ${input.completedCount}.`,
          `No-shows: ${input.noShowCount}.`,
          `Customer-cancelled: ${input.cancelledCount}.`,
        ].join(' ');

  const leadTime =
    input.leadTimeHours === null
      ? 'Booking lead time is unknown.'
      : `This booking was made ${input.leadTimeHours.toFixed(
          1,
        )} hours before the appointment.`;

  return [
    'You help front-desk staff at an appointment-based business gauge no-show risk.',
    "Write ONE short, plain-language sentence (max 30 words) summarising this customer's no-show risk and the reason.",
    'Use only the facts given. Do not address the customer. No preamble — output only the sentence.',
    '',
    history,
    leadTime,
  ].join('\n');
}

/**
 * BullMQ handler for `score-no-show-risk` (architecture doc §10).
 *
 * Never throws for a domain reason — every failure path (booking gone,
 * already scored, Gemini unavailable) is a silent no-op that leaves
 * `noShowRiskNote` untouched. The write is conditioned on the field
 * still being null (`persistNoShowRiskNote`), so a duplicated/retried
 * job is a safe no-op and no `Booking.status` re-check is needed: this
 * write has no externally-visible effect, so "written at most once" is
 * the only invariant to protect.
 *
 * A booking that was cancelled or rescheduled between confirmation and
 * this job running still receives its note — it reflects the customer's
 * history at booking time and is never recomputed afterwards.
 */
export async function runNoShowScoringJob(
  bookingId: string,
): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    logger.warn({ bookingId }, 'no-show scoring: invalid bookingId, skipping');
    return;
  }

  try {
    const context = await getBookingScoringContext(bookingId);

    if (!context) {
      logger.warn(
        { bookingId },
        'no-show scoring: booking not found, skipping',
      );
      return;
    }

    // Compute-once guard (§10). The conditional write below is the real
    // guarantee; this just avoids a pointless Gemini call.
    if (context.noShowRiskNote !== null) {
      return;
    }

    // "The same customer" is matched by contact within this business
    // only — no cross-tenant identity resolution (§10).
    const stats = await getCustomerBookingStats(
      context.businessId,
      context.customer.contactType,
      context.customer.contact,
      bookingId,
    );

    let leadTimeHours: number | null = null;
    const slot = await getSlotById(context.businessId, context.slotId);
    if (slot) {
      const hours =
        (new Date(slot.datetime).getTime() - context.createdAt.getTime()) /
        3_600_000;
      leadTimeHours = Number.isFinite(hours) ? hours : null;
    }

    const note = await generateRiskNote(
      buildPrompt({
        totalPast: stats.totalPast,
        completedCount: stats.completedCount,
        cancelledCount: stats.cancelledCount,
        noShowCount: stats.noShowCount,
        leadTimeHours,
      }),
    );

    if (!note) {
      logger.info(
        { bookingId },
        'no-show scoring: no risk data, leaving note null',
      );
      return;
    }

    const written = await persistNoShowRiskNote(bookingId, note);

    logger.info(
      { bookingId, written },
      written
        ? 'no-show scoring: risk note persisted'
        : 'no-show scoring: note already set by an earlier run, skipped',
    );
  } catch (error) {
    // Silent fallback (§10): AI failure never blocks, delays, or alters
    // the booking. Log and move on — there is no retry/backfill.
    logger.warn(
      { err: error, bookingId },
      'no-show scoring: job errored, skipping',
    );
  }
}
