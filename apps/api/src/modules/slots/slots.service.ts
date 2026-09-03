/**
 * Service layer for the Slots module.
 *
 * `generateWeeklySlots` is the entire "generate-weekly-slots" job from
 * the architecture doc (Section 6), built as a plain callable function
 * rather than a scheduled job — there is no BullMQ/cron infra in this
 * codebase yet. A future scheduler calls this same function unchanged;
 * for now it's triggered by an owner-only HTTP endpoint
 * (`slots.controller.ts`).
 *
 * Responsibilities:
 *   - Read `ProviderAvailability` templates (architecture doc Section 2)
 *     and chop each weekly window into individual bookable `Slot`
 *     documents, one per unit of capacity for a resource provider.
 *   - Convert each template's business-local wall-clock time to a UTC
 *     instant via Luxon (DST-aware — never fixed-offset arithmetic,
 *     Section 6).
 *   - Stay idempotent on `(providerId, providerType, datetime, unitIndex)`
 *     — re-running never creates duplicates.
 *   - Re-check provider/service active status immediately before AND
 *     after inserting, with a conditional compensating delete if either
 *     went inactive mid-run (Section 6's race-safety requirement).
 *   - Never create a Slot in any status but 'available' — hold/confirm/
 *     cancel/block are all out of this module's scope.
 */

import { DateTime } from 'luxon';

import type {
  ProviderAvailability,
  ProviderType,
  WeeklyAvailabilityWindow,
} from '@queueless/shared-types';

import { getBusinessById } from '../tenants/index.js';
import { getAvailability } from '../availability/index.js';
import { validateProvider } from '../providers/index.js';
import { getServiceById } from '../services/index.js';
import { getResourceById } from '../resources/index.js';

import { SlotModel, type SlotDocument } from './slots.model.js';

/** How far ahead a single run generates slots for, unless overridden. */
const DEFAULT_GENERATION_DAYS = 7;

export interface GenerateSlotsOptions {
  /** Rolling window length, starting now. Defaults to 7. */
  days?: number;
}

export interface GenerateSlotsResult {
  /** Slots actually inserted by this run. */
  created: number;
  /** Candidate slots that already existed (the idempotency path). */
  skippedExisting: number;
  /**
   * ProviderAvailability templates skipped entirely because their
   * provider or service failed the pre-insert active check.
   */
  skippedInactiveProviders: number;
}

/**
 * A single candidate slot, fully computed and ready to insert — one
 * per (window tick, unitIndex) combination.
 */
interface SlotCandidate {
  datetime: Date;
  unitIndex: number;
}

/**
 * Chops one provider's weekly availability windows into individual
 * UTC-instant ticks across the target rolling window, sized to the
 * service's duration.
 *
 * DST-aware by construction: every wall-clock -> UTC conversion goes
 * through Luxon's zone-aware `DateTime`, never a fixed offset (Section 6).
 */
function computeCandidateTicks(params: {
  zone: string;
  days: number;
  windows: WeeklyAvailabilityWindow[];
  durationMinutes: number;
  now: DateTime;
}): Date[] {
  const { zone, days, windows, durationMinutes, now } = params;
  const ticks: Date[] = [];
  const seen = new Set<number>();
  const startOfToday = now.setZone(zone).startOf('day');

  for (let offset = 0; offset < days; offset++) {
    const date = startOfToday.plus({ days: offset });
    // Luxon weekday: 1 = Monday .. 7 = Sunday. Convert to this
    // codebase's 0 = Sunday .. 6 = Saturday (availability.model.ts).
    const dayOfWeek = date.weekday % 7;

    for (const window of windows) {
      if (window.dayOfWeek !== dayOfWeek) continue;

      const [startHour, startMinute] = window.startTime
        .split(':')
        .map(Number);
      const [endHour, endMinute] = window.endTime.split(':').map(Number);

      const windowEnd = date.set({
        hour: endHour,
        minute: endMinute,
        second: 0,
        millisecond: 0,
      });

      let tick = date.set({
        hour: startHour,
        minute: startMinute,
        second: 0,
        millisecond: 0,
      });

      while (tick.plus({ minutes: durationMinutes }) <= windowEnd) {
        const utc = tick.toUTC().toJSDate();
        const utcMillis = utc.getTime();

        if (utcMillis > now.toMillis() && !seen.has(utcMillis)) {
          seen.add(utcMillis);
          ticks.push(utc);
        }

        tick = tick.plus({ minutes: durationMinutes });
      }
    }
  }

  return ticks;
}

/**
 * Verifies a template's provider and service are both still usable
 * right now. Used both immediately before inserting and immediately
 * after (Section 6) — the same check, called twice around the write.
 */
async function isTemplateStillGenerable(
  businessId: string,
  providerId: string,
  providerType: ProviderType,
  serviceId: string,
): Promise<boolean> {
  const providerResult = await validateProvider(
    businessId,
    providerId,
    providerType,
  );

  if (!providerResult.ok) {
    return false;
  }

  const service = await getServiceById(businessId, serviceId);

  return service !== null && service.isActive;
}

/** Resource capacity is 1..N; a staff provider always has exactly 1 unit. */
async function resolveCapacity(
  businessId: string,
  providerId: string,
  providerType: ProviderType,
): Promise<number> {
  if (providerType === 'staff') {
    return 1;
  }

  const resource = await getResourceById(businessId, providerId);
  return resource?.capacity ?? 0;
}

/**
 * Mongoose's `insertMany(docs, { ordered: false })` throws on any
 * duplicate-key failure, but (per Mongoose's documented unordered-
 * insert behavior) attaches `insertedDocs` — the subset that DID
 * succeed — to the thrown error. This lets a race against a
 * concurrent generation run degrade to "some inserted, some skipped
 * as already-existing" instead of failing the whole batch.
 */
interface BulkWriteErrorLike {
  insertedDocs?: Array<{ _id: unknown }>;
  writeErrors?: Array<{ code?: number; err?: { code?: number } }>;
  code?: number;
}

function isDuplicateKeyError(error: unknown): error is { code: 11000 } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function isBulkWriteErrorLike(error: unknown): error is BulkWriteErrorLike {
  return typeof error === 'object' && error !== null;
}

/** True only when every failure in the batch was a duplicate key — anything else must not be swallowed. */
function allWriteErrorsAreDuplicates(error: BulkWriteErrorLike): boolean {
  if (!Array.isArray(error.writeErrors) || error.writeErrors.length === 0) {
    return false;
  }
  return error.writeErrors.every(
    (writeError) =>
      writeError.code === 11000 || writeError.err?.code === 11000,
  );
}

/**
 * Generates the next `options.days` (default 7) worth of bookable
 * Slots for every ProviderAvailability template in a business, from
 * right now.
 *
 * Idempotent on `(businessId, providerId, providerType, datetime,
 * unitIndex)` — safe to re-run (a retry, a manual trigger) without
 * ever creating duplicates.
 */
export async function generateWeeklySlots(
  businessId: string,
  options: GenerateSlotsOptions = {},
): Promise<GenerateSlotsResult> {
  const days = options.days ?? DEFAULT_GENERATION_DAYS;

  const business = await getBusinessById(businessId);
  if (!business) {
    // A stale/malformed businessId is treated as "nothing to generate"
    // rather than thrown — every caller already resolves businessId
    // from a live authenticated session.
    return { created: 0, skippedExisting: 0, skippedInactiveProviders: 0 };
  }

  const templates: ProviderAvailability[] = await getAvailability(businessId);

  const now = DateTime.utc();

  const result: GenerateSlotsResult = {
    created: 0,
    skippedExisting: 0,
    skippedInactiveProviders: 0,
  };

  for (const template of templates) {
    if (template.weeklyWindows.length === 0) continue;

    // Pre-check (Section 6): skip this template entirely if its
    // provider or service isn't currently active — never throws, a
    // template going inactive between generation runs is expected,
    // routine state, not an error.
    const generableBefore = await isTemplateStillGenerable(
      businessId,
      template.providerId,
      template.providerType,
      template.serviceId,
    );

    if (!generableBefore) {
      result.skippedInactiveProviders += 1;
      continue;
    }

    const service = await getServiceById(businessId, template.serviceId);
    // Already confirmed active and existing by isTemplateStillGenerable
    // above; this can only be null on an impossible concurrent hard-
    // delete, which this codebase never performs on Services.
    if (!service) {
      result.skippedInactiveProviders += 1;
      continue;
    }

    const capacity = await resolveCapacity(
      businessId,
      template.providerId,
      template.providerType,
    );

    if (capacity < 1) {
      result.skippedInactiveProviders += 1;
      continue;
    }

    const ticks = computeCandidateTicks({
      zone: business.timezone,
      days,
      windows: template.weeklyWindows,
      durationMinutes: service.durationMinutes,
      now,
    });

    if (ticks.length === 0) continue;

    const candidates: SlotCandidate[] = [];
    for (const datetime of ticks) {
      for (let unitIndex = 0; unitIndex < capacity; unitIndex += 1) {
        candidates.push({ datetime, unitIndex });
      }
    }

    // Dedupe against slots that already exist for this provider within
    // the candidate window — the primary idempotency mechanism
    // (Section 6: "checks whether a Slot already exists before
    // inserting"). The unique index below is the backstop for the
    // remaining race, not the primary mechanism.
    const existing = await SlotModel.find({
      businessId,
      providerId: template.providerId,
      providerType: template.providerType,
      datetime: { $in: ticks },
    })
      .select({ datetime: 1, unitIndex: 1 })
      .lean();

    const existingKeys = new Set(
      existing.map((slot) => `${slot.datetime.getTime()}|${slot.unitIndex}`),
    );

    const toInsert = candidates.filter(
      (candidate) =>
        !existingKeys.has(`${candidate.datetime.getTime()}|${candidate.unitIndex}`),
    );

    result.skippedExisting += candidates.length - toInsert.length;

    if (toInsert.length === 0) continue;

    const docs = toInsert.map((candidate) => ({
      businessId,
      providerId: template.providerId,
      providerType: template.providerType,
      serviceId: template.serviceId,
      datetime: candidate.datetime,
      durationMinutes: service.durationMinutes,
      unitIndex: candidate.unitIndex,
      status: 'available' as const,
      holdVersion: null,
      version: 0,
    }));

    let insertedIds: unknown[] = [];

    try {
      const inserted = await SlotModel.insertMany(docs, { ordered: false });
      insertedIds = inserted.map((doc) => doc._id);
      result.created += inserted.length;
    } catch (error) {
      if (
        isBulkWriteErrorLike(error) &&
        Array.isArray(error.insertedDocs) &&
        allWriteErrorsAreDuplicates(error)
      ) {
        insertedIds = error.insertedDocs.map((doc) => doc._id);
        result.created += error.insertedDocs.length;
        result.skippedExisting += docs.length - error.insertedDocs.length;
      } else if (isDuplicateKeyError(error)) {
        // Whole batch collided; nothing inserted from this batch.
        result.skippedExisting += docs.length;
      } else {
        throw error;
      }
    }

    if (insertedIds.length === 0) continue;

    // Post-check (Section 6): if the provider or service went
    // inactive in the narrow window between the pre-check and this
    // insert, conditionally delete only what this run just inserted —
    // never an unconditional delete by _id, so a slot claimed in that
    // same instant is never destroyed.
    const generableAfter = await isTemplateStillGenerable(
      businessId,
      template.providerId,
      template.providerType,
      template.serviceId,
    );

    if (!generableAfter) {
      const deleted = await SlotModel.deleteMany({
        _id: { $in: insertedIds },
        status: 'available',
      });
      result.created -= deleted.deletedCount ?? 0;
    }
  }

  return result;
}

export interface ListSlotsFilter {
  providerId?: string;
  providerType?: ProviderType;
  from?: Date;
  to?: Date;
}

/**
 * A slot as read back from Mongoose, mapped to the shared API type.
 */
function toSlotApiShape(
  slot: Pick<
    SlotDocument,
    | 'businessId'
    | 'providerId'
    | 'providerType'
    | 'serviceId'
    | 'datetime'
    | 'durationMinutes'
    | 'unitIndex'
    | 'status'
  > & { _id: unknown },
) {
  return {
    id: String(slot._id),
    businessId: slot.businessId,
    providerId: slot.providerId,
    providerType: slot.providerType,
    serviceId: slot.serviceId,
    datetime: slot.datetime.toISOString(),
    durationMinutes: slot.durationMinutes,
    unitIndex: slot.unitIndex,
    status: slot.status,
  };
}

/**
 * Lists slots belonging to a business, optionally narrowed by
 * provider and/or a datetime range. Mostly a verification/debugging
 * aid for this module today — a head start for whatever
 * staff-dashboard or public booking-page view needs next.
 */
export async function listSlots(
  businessId: string,
  filter: ListSlotsFilter = {},
) {
  const query: Record<string, unknown> = { businessId };

  if (filter.providerId !== undefined) {
    query.providerId = filter.providerId;
  }

  if (filter.providerType !== undefined) {
    query.providerType = filter.providerType;
  }

  if (filter.from !== undefined || filter.to !== undefined) {
    const range: Record<string, Date> = {};
    if (filter.from !== undefined) range.$gte = filter.from;
    if (filter.to !== undefined) range.$lte = filter.to;
    query.datetime = range;
  }

  const slots = await SlotModel.find(query).sort({ datetime: 1 }).lean();

  return slots.map(toSlotApiShape);
}
