/**
 * Mongoose schema for the Availability module.
 *
 * Stores `ProviderAvailability` — the recurring weekly template that
 * slot generation reads to produce bookable `Slot` documents.
 *
 * It is a generation template, not a live schedule: edits apply in place
 * with no versioning, and only affect future generation runs. Slots
 * already generated are never retroactively resized or deleted.
 */

import { Schema, model } from 'mongoose';

import type { ProviderType } from '@queueless/shared-types';

/**
 * One recurring window inside a week, e.g. "Monday 09:00–17:00".
 *
 * Mirrors the public `WeeklyAvailabilityWindow` API type but is kept as a
 * separate Mongo sub-document shape.
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
 * A "provider" is whoever/whatever a Slot is generated for. `providerId`
 * points at either a `Users` row (`providerType` 'staff') or a
 * `Resources` row (`providerType` 'resource').
 */
export interface ProviderAvailabilityDocument {
  /** Owning business — every query is scoped by this. */
  businessId: string;
  /** Ref to a Users row (staff) or a Resources row (resource). */
  providerId: string;
  /** Which collection `providerId` refers to. */
  providerType: ProviderType;
  /**
   * The service this template generates slots for. A provider offering
   * two services with different durations needs two separate rows.
   */
  serviceId: string;
  /** Recurring weekly windows; empty means "no availability yet". */
  weeklyWindows: WeeklyAvailabilityWindowDocument[];
}

/**
 * Sub-schema for a weekly window.
 *
 * `_id: false` because these are value objects embedded in the parent
 * document, not independently addressable records.
 */
const weeklyAvailabilityWindowSchema =
  new Schema<WeeklyAvailabilityWindowDocument>(
    {
      // Valid day-of-week index, enforced at the DB layer.
      dayOfWeek: {
        type: Number,
        min: 0,
        max: 6,
        required: true,
      },

      // Plain "HH:mm" string in business-local time; converted to UTC
      // only at slot-generation time.
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
 * `providerType` is enum-constrained here as cheap protection against a
 * typo; the real cross-collection check that `providerId` resolves to a
 * real, same-business provider lives in the `providers` module.
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
 * modules go through `./index.ts`.
 */
export const ProviderAvailabilityModel =
  model<ProviderAvailabilityDocument>(
    'ProviderAvailability',
    providerAvailabilitySchema,
  );
