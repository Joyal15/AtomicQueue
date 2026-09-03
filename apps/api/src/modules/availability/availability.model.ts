/**
 * Mongoose schema for the Availability module.
 *
 * This file owns the persistence shape for `ProviderAvailability` —
 * the recurring weekly template that `generate-weekly-slots`
 * (Phase 3) reads to produce bookable `Slot` documents.
 *
 * It is a generation TEMPLATE, not a live schedule:
 *   - Edits are applied in place, with no versioning or history.
 *   - A change only affects FUTURE generation runs; slots that were
 *     already generated are never retroactively resized or deleted.
 *
 * See the architecture doc Section 2 / 2a for the unified provider
 * model this shape has to match.
 */

import { Schema, model } from 'mongoose';

import type { ProviderType } from '@queueless/shared-types';

/**
 * One recurring window inside a week, e.g. "Monday 09:00–17:00".
 *
 * This is the Mongo sub-document shape. It mirrors the public
 * `WeeklyAvailabilityWindow` API type but is kept separate so the
 * storage contract and the API contract can diverge independently.
 */
export interface WeeklyAvailabilityWindowDocument {
  /** 0 = Sunday … 6 = Saturday. */
  dayOfWeek: number;
  /** Business-local wall-clock time ("HH:mm"), interpreted in Business.timezone — never UTC. */
  startTime: string;
  /** Business-local wall-clock time ("HH:mm"), must be after startTime. */
  endTime: string;
}

/**
 * A single provider's availability template for one service.
 *
 * A "provider" is whoever/whatever a Slot is generated for. The
 * `providerId` points at either a `Users` row (`providerType`
 * 'staff') or a `Resources` row (`providerType` 'resource'); the
 * booking/generation engine never forks on which.
 */
export interface ProviderAvailabilityDocument {
  /** Owning business — every query is scoped by this. */
  businessId: string;
  /** Ref to a Users row (staff) or a Resources row (resource). */
  providerId: string;
  /** Which collection `providerId` refers to. */
  providerType: ProviderType;
  /**
   * The service this template generates slots for. REQUIRED — a
   * provider offering two services with different durations needs
   * two separate rows with non-overlapping windows (architecture
   * doc Section 2, "Multi-service providers").
   */
  serviceId: string;
  /** Recurring weekly windows; empty means "no availability yet". */
  weeklyWindows: WeeklyAvailabilityWindowDocument[];
}

/**
 * Sub-schema for a weekly window.
 *
 * `_id: false` because these are value objects embedded in the
 * parent document, not independently addressable records.
 */
const weeklyAvailabilityWindowSchema =
  new Schema<WeeklyAvailabilityWindowDocument>(
    {
      // Constrained to a valid day-of-week index at the DB layer.
      dayOfWeek: {
        type: Number,
        min: 0,
        max: 6,
        required: true,
      },

      // Stored as a plain "HH:mm" string in business-local time;
      // conversion to UTC happens only at slot-generation time.
      startTime: {
        type: String,
        required: true,
      },

      endTime: {
        type: String,
        required: true,
      },
    },
    {
      _id: false,
    },
  );

/**
 * Top-level schema for provider availability.
 *
 * `businessId` ensures every row belongs to exactly one business
 * and makes tenant-scoped queries possible.
 *
 * `providerType` is enum-constrained here as cheap protection
 * against a typo corrupting data; the cross-collection check that
 * `providerId` actually resolves to a real, same-business provider
 * lives in the `providers` module's validation function, since
 * MongoDB cannot enforce cross-collection references itself
 * (architecture doc Section 2b).
 *
 * `timestamps` gives us `createdAt` / `updatedAt` for free — useful
 * for debugging which template a generation run used.
 */
const providerAvailabilitySchema =
  new Schema<ProviderAvailabilityDocument>(
    {
      businessId: {
        type: String,
        required: true,
      },

      providerId: {
        type: String,
        required: true,
      },

      providerType: {
        type: String,
        enum: ['staff', 'resource'],
        required: true,
      },

      serviceId: {
        type: String,
        required: true,
      },

      weeklyWindows: {
        type: [weeklyAvailabilityWindowSchema],
        default: [],
      },
    },
    {
      timestamps: true,
    },
  );

/**
 * Mongoose model used to create and query provider availability.
 *
 * Only the Availability service layer touches this directly; other
 * modules go through `./index.ts`'s exported functions.
 */
export const ProviderAvailabilityModel =
  model<ProviderAvailabilityDocument>(
    'ProviderAvailability',
    providerAvailabilitySchema,
  );
