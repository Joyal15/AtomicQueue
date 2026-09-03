/**
 * Mongoose schema for the Slots module.
 *
 * A `Slot` is an actual bookable time unit, generated FROM a
 * `ProviderAvailability` template (`availability` module) by
 * `generateWeeklySlots` (`slots.service.ts`). Slots and their
 * generation template are deliberately separate collections — a
 * provider's availability template can be edited without touching
 * already-generated slots (architecture doc Section 2).
 */

import { Schema, model } from 'mongoose';

import type { ProviderType } from '@queueless/shared-types';

export type SlotStatus =
  | 'available'
  | 'held'
  | 'confirmed'
  | 'cancelled'
  | 'blocked';

export interface SlotDocument {
  /** Owning business — every query is scoped by this. */
  businessId: string;
  /** Ref to a Users row (staff) or a Resources row (resource). */
  providerId: string;
  /** Which collection `providerId` refers to. */
  providerType: ProviderType;
  /** The service this slot was generated for. */
  serviceId: string;
  /** UTC instant this slot starts at. */
  datetime: Date;
  /**
   * Snapshotted from Service.durationMinutes ONCE, at generation time,
   * and never updated again for this Slot — the single deliberate
   * exception to this design's "no snapshot, live resolution" rule
   * (architecture doc Section 2).
   */
  durationMinutes: number;
  /**
   * 0 for a staff provider; 0..capacity-1 for a resource's parallel
   * units. Distinguishes otherwise-identical slot documents so a
   * genuine uniqueness constraint is possible (architecture doc
   * Section 2b).
   */
  unitIndex: number;
  status: SlotStatus;
  /**
   * Fencing/version token for the hold/confirm flow. Non-null iff
   * `status === 'held'`; cleared to null on every held -> X
   * transition. Nothing in this module's generation path ever sets
   * this to anything but null — included now for schema completeness
   * so the future hold/claim work needs no migration.
   */
  holdVersion: string | null;
  /**
   * Reserved for optimistic-concurrency checks on non-booking edits
   * (e.g. staff manually moving a slot's time). Unrelated to
   * `holdVersion` above; unused by this module.
   */
  version: number;
}

const slotSchema = new Schema<SlotDocument>(
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

    datetime: {
      type: Date,
      required: true,
    },

    durationMinutes: {
      type: Number,
      required: true,
    },

    unitIndex: {
      type: Number,
      required: true,
      default: 0,
    },

    status: {
      type: String,
      enum: ['available', 'held', 'confirmed', 'cancelled', 'blocked'],
      required: true,
      default: 'available',
    },

    holdVersion: {
      type: String,
      default: null,
    },

    version: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

// The data-integrity backstop against duplicate/malformed slot
// generation (a generation bug, the weekly job racing itself).
// `serviceId` is deliberately NOT part of this key — a provider
// physically cannot hold two slots at the same instant regardless of
// which service they're nominally for (architecture doc Section 2b).
slotSchema.index(
  { businessId: 1, providerId: 1, providerType: 1, datetime: 1, unitIndex: 1 },
  { unique: true },
);

// Supports the hot-path claim query's performance — a separate
// mechanism from the unique index above, serving a separate purpose
// (architecture doc Section 2b).
slotSchema.index({
  businessId: 1,
  providerId: 1,
  providerType: 1,
  datetime: 1,
  status: 1,
});

/**
 * Mongoose model used to create and query slots.
 *
 * Only the Slots service layer touches this directly; other modules
 * go through `./index.ts`'s exported functions.
 */
export const SlotModel = model<SlotDocument>('Slot', slotSchema);
