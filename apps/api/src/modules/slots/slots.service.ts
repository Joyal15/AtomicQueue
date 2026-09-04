/**
 * Service layer for the Slots module.
 *
 * `generateWeeklySlots` reads `ProviderAvailability` templates and
 * chops each weekly window into bookable `Slot` documents (one per
 * capacity unit for a resource provider), converting business-local
 * time to UTC via Luxon so DST is handled correctly. Re-running is
 * idempotent on `(providerId, providerType, datetime, unitIndex)` —
 * it never creates duplicates. Only ever creates slots in 'available'
 * status; hold/confirm/cancel/block happen elsewhere.
 */

import { DateTime } from 'luxon';
import { Types } from 'mongoose';

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
import { emitSlotUpdate } from '../realtime/index.js';
import type { ClientSession } from 'mongoose';

import { SlotModel, type SlotDocument, type SlotStatus } from './slots.model.js';

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
 * Chops one provider's weekly availability windows into UTC-instant
 * ticks across the rolling window, sized to the service's duration.
 * Uses Luxon's zone-aware DateTime so DST is handled correctly.
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
    // Luxon weekday is 1=Monday..7=Sunday; convert to 0=Sunday..6=Saturday.
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
 * Verifies a template's provider and service are both still active.
 * Called both right before and right after inserting slots.
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
 * `insertMany(docs, { ordered: false })` throws on a duplicate-key
 * failure but attaches `insertedDocs` (the ones that succeeded) to
 * the error, so a race with a concurrent generation run can still
 * report partial success instead of failing the whole batch.
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

/** True only when every failure in the batch was a duplicate key. */
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
 * Slots for every ProviderAvailability template in a business.
 * Safe to re-run — never creates duplicates.
 */
export async function generateWeeklySlots(
  businessId: string,
  options: GenerateSlotsOptions = {},
): Promise<GenerateSlotsResult> {
  const days = options.days ?? DEFAULT_GENERATION_DAYS;

  const business = await getBusinessById(businessId);
  if (!business) {
    // Unknown businessId: nothing to generate.
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

    // Skip this template if its provider or service isn't currently active.
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
    // Already checked active above; null here would mean a concurrent delete.
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

    // Skip candidates that already have a slot; the model's unique
    // index is the backstop for any remaining race.
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
        // Whole batch collided; nothing inserted.
        result.skippedExisting += docs.length;
      } else {
        throw error;
      }
    }

    if (insertedIds.length === 0) continue;

    // Re-check after inserting: if the provider/service went inactive
    // mid-run, delete only the slots this run just inserted (and only
    // if still available, so a slot claimed in that instant survives).
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
  serviceId?: string;
  status?: SlotStatus;
  from?: Date;
  to?: Date;
}

/**
 * Maps a slot document to the shared API type.
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
 * Lists slots belonging to a business, optionally filtered by
 * provider, service, status, and/or a datetime range.
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

  if (filter.serviceId !== undefined) {
    query.serviceId = filter.serviceId;
  }

  if (filter.status !== undefined) {
    query.status = filter.status;
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

export async function getSlotById(
  businessId: string,
  slotId: string,
): Promise<{
  id: string;
  businessId: string;
  providerId: string;
  providerType: ProviderType;
  serviceId: string;
  datetime: string;
  durationMinutes: number;
  unitIndex: number;
  status: SlotStatus;
} | null> {
  if (!Types.ObjectId.isValid(slotId)) {
    return null;
  }

  const slot = await SlotModel.findOne({
    _id: slotId,
    businessId,
  }).lean();

  if (!slot) {
    return null;
  }

  return toSlotApiShape(slot);
}

export interface GetAvailableSlotsFilter {
  providerId?: string;
  providerType?: ProviderType;
  serviceId?: string;
  from?: Date;
  to?: Date;
}

/**
 * Returns a business's currently claimable slots (`status: 'available'`
 * only), optionally filtered by provider/service/date-range. Thin
 * wrapper over `listSlots`.
 */
export async function getAvailableSlots(
  businessId: string,
  filter: GetAvailableSlotsFilter = {},
) {
  return listSlots(businessId, { ...filter, status: 'available' });
}

export interface PublicAvailabilityFilter {
  serviceId?: string;
  providerId?: string;
  providerType?: ProviderType;
}

export interface PublicAvailabilityBucket {
  providerId: string;
  providerType: ProviderType;
  serviceId: string;
  datetime: string;
  durationMinutes: number;
  /** Total units generated for this provider+time — a resource's capacity, or 1 for staff. */
  total: number;
  /** Units still status: 'available'. Never a specific unit — units aren't distinguishable to a customer. */
  remaining: number;
}

/**
 * Public, unauthenticated browsing view. Groups Slots by
 * (providerId, providerType, datetime) and reports remaining vs.
 * total capacity per bucket (e.g. "2 of 3 left") instead of exposing
 * individual anonymous slot documents — a customer picks a time, never
 * a specific interchangeable unit (architecture doc §4b).
 *
 * `datetime >= now` is applied fresh on every call, not stored — a
 * slot's bookability from a customer's perspective is always computed
 * live (§4b's past-slot-filtering rule), same as everywhere else this
 * project checks it.
 */
export async function getPublicAvailabilityBuckets(
  businessId: string,
  filter: PublicAvailabilityFilter = {},
): Promise<PublicAvailabilityBucket[]> {
  const match: Record<string, unknown> = {
    businessId,
    datetime: { $gte: new Date() },
  };

  if (filter.serviceId !== undefined) match.serviceId = filter.serviceId;
  if (filter.providerId !== undefined) match.providerId = filter.providerId;
  if (filter.providerType !== undefined) match.providerType = filter.providerType;

  const buckets = await SlotModel.aggregate<{
    _id: { providerId: string; providerType: ProviderType; datetime: Date };
    serviceId: string;
    durationMinutes: number;
    total: number;
    remaining: number;
  }>([
    { $match: match },
    {
      $group: {
        _id: {
          providerId: '$providerId',
          providerType: '$providerType',
          datetime: '$datetime',
        },
        // All units in one bucket come from the same generation run
        // (same template), so serviceId/durationMinutes are uniform —
        // $first is just picking the one value, not an approximation.
        serviceId: { $first: '$serviceId' },
        durationMinutes: { $first: '$durationMinutes' },
        total: { $sum: 1 },
        remaining: {
          $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] },
        },
      },
    },
    { $sort: { '_id.datetime': 1 } },
  ]);

  return buckets.map((bucket) => ({
    providerId: bucket._id.providerId,
    providerType: bucket._id.providerType,
    serviceId: bucket.serviceId,
    datetime: bucket._id.datetime.toISOString(),
    durationMinutes: bucket.durationMinutes,
    total: bucket.total,
    remaining: bucket.remaining,
  }));
}

export type BlockSlotError = 'SLOT_NOT_FOUND' | 'SLOT_NOT_AVAILABLE';

export type BlockSlotResult =
  | { ok: true; slot: ReturnType<typeof toSlotApiShape> }
  | { ok: false; error: BlockSlotError };

/**
 * Manually blocks one `available` slot (e.g. a provider calling in
 * sick), via a single atomic conditional write. `blocked` is
 * terminal — a slot can't be unblocked, only regenerated later.
 */
export async function blockSlot(
  businessId: string,
  slotId: string,
): Promise<BlockSlotResult> {
  // A malformed id would otherwise throw a CastError instead of returning "not found".
  if (!Types.ObjectId.isValid(slotId)) {
    return { ok: false, error: 'SLOT_NOT_FOUND' };
  }

  const slot = await SlotModel.findOneAndUpdate(
    { _id: slotId, businessId, status: 'available' },
    { status: 'blocked' },
    { new: true },
  ).lean();

  if (slot) {
    const apiSlot = toSlotApiShape(slot);
    // Best-effort push so a connected booking page/staff dashboard
    // drops this slot immediately instead of waiting for a refetch.
    emitSlotUpdate(businessId, { slotId: apiSlot.id, status: apiSlot.status });
    return { ok: true, slot: apiSlot };
  }

  // Distinguish "doesn't exist" (404) from "exists but wasn't available" (409).
  const exists = await SlotModel.exists({ _id: slotId, businessId });

  return {
    ok: false,
    error: exists ? 'SLOT_NOT_AVAILABLE' : 'SLOT_NOT_FOUND',
  };
}

/**
 * Counts how many 'available' units remain for one (businessId,
 * providerId, providerType, serviceId, datetime) bucket — the same
 * count the public availability aggregation reports (§4b), scoped to
 * a single bucket instead of every future one. Always reads fresh
 * after a write, never derived from that write's own result: a
 * concurrent claim on a *different* unit in the same capacity-N
 * bucket isn't visible to a single document's update result, only to
 * a live re-count.
 */
export async function getRemainingCapacity(
  businessId: string,
  providerId: string,
  providerType: ProviderType,
  serviceId: string,
  datetime: Date | string,
): Promise<number> {
  const parsedDatetime = new Date(datetime);

  if (Number.isNaN(parsedDatetime.getTime())) {
    return 0;
  }

  return SlotModel.countDocuments({
    businessId,
    providerId,
    providerType,
    serviceId,
    datetime: parsedDatetime,
    status: 'available',
  });
}

export async function emitBookingConfirmationUpdate(
  businessId: string,
  providerId: string,
  providerType: ProviderType,
  serviceId: string,
  datetime: Date | string,
): Promise<void> {
  const parsedDatetime = new Date(datetime);

  if (Number.isNaN(parsedDatetime.getTime())) {
    return;
  }

  const remaining = await getRemainingCapacity(
    businessId,
    providerId,
    providerType,
    serviceId,
    parsedDatetime,
  );

  emitSlotUpdate(businessId, {
    providerId,
    providerType,
    datetime: parsedDatetime.toISOString(),
    remaining,
  });
}

export interface ConfirmAvailableSlotResult {
  slotId: string;
}

/**
 * Directly confirms one available slot for (businessId, providerId,
 * providerType, serviceId, datetime) — the staff/owner walk-in path
 * (architecture doc §3). A separate transition from claimSlot: skips
 * `held` entirely (`holdVersion` is left untouched — still whatever it
 * already was, i.e. null, since the doc is currently 'available'), no
 * Redis, no Mongo transaction. A walk-in has no "customer might
 * abandon the tab" race to guard against, so the single atomic
 * conditional write below is already sufficient on its own (§4c) —
 * there's no multi-step claim-then-confirm sequence here to protect.
 *
 * Same identifying tuple as claimSlot, not a specific slotId: for a
 * capacity-N resource there are N interchangeable available units at
 * this provider+datetime, and the caller can't (and shouldn't) know
 * which one it lands on.
 */
export async function confirmAvailableSlot(
  businessId: string,
  providerId: string,
  providerType: ProviderType,
  serviceId: string,
  datetime: Date | string,
): Promise<ConfirmAvailableSlotResult | null> {
  const parsedDatetime = new Date(datetime);

  if (Number.isNaN(parsedDatetime.getTime())) {
    return null;
  }

  const slot = await SlotModel.findOneAndUpdate(
    {
      businessId,
      providerId,
      providerType,
      serviceId,
      datetime: parsedDatetime,
      status: 'available',
    },
    {
      status: 'confirmed',
    },
    { new: true },
  )
    .select({ _id: 1 })
    .lean();

  if (!slot) {
    return null;
  }

  const slotId = String(slot._id);

  // A confirm permanently consumes one unit of public availability, so
  // this is a bucket-count update (§4b), not a single-slot status ping
  // — the customer browsing page never knew this slotId to begin with.
  const remaining = await getRemainingCapacity(
    businessId,
    providerId,
    providerType,
    serviceId,
    parsedDatetime,
  );

  emitSlotUpdate(businessId, {
    providerId,
    providerType,
    datetime: parsedDatetime.toISOString(),
    remaining,
  });

  return { slotId };
}

export type ClaimSlotResult =
  | {
      ok: true;
      slotId: string;
      holdVersion: string;
    }
  | {
      ok: false;
      error: 'SLOT_NOT_AVAILABLE';
    }
  | {
      ok: false;
      error: 'SLOT_HELD';
      slotId: string;
      holdVersion: string;
    };

/**
 * Atomically claims one available slot for (businessId, providerId,
 * providerType, serviceId, datetime) and transitions it available ->
 * held, stamping a fresh holdVersion (a fencing token, not a secret —
 * the caller is expected to pair this with its own Redis TTL hold).
 *
 * Deliberately doesn't take a specific slotId or unitIndex: for a
 * capacity-N resource, any interchangeable unit at that
 * provider+datetime will do. `findOneAndUpdate` picks and updates one
 * matching document atomically, so concurrent callers each land on a
 * different available unit (or get SLOT_NOT_AVAILABLE once none are
 * left) with no extra locking needed.
 *
 * Returns SLOT_NOT_AVAILABLE for every failure mode (no matching
 * slot, wrong service, confirmed/blocked/cancelled, bad datetime)
 * except one: if the target is currently held, the caller gets
 * SLOT_HELD with that slot's observed slotId/holdVersion, so it can
 * attempt the claim-triggered lazy release (check Redis for that
 * exact holdVersion's key; if it's missing, call releaseHeldSlot with
 * it, then retry the claim) instead of giving up on a stale hold.
 */
export async function claimSlot(
  businessId: string,
  providerId: string,
  providerType: ProviderType,
  serviceId: string,
  datetime: Date | string,
): Promise<ClaimSlotResult> {
  const parsedDatetime = new Date(datetime);

  if (Number.isNaN(parsedDatetime.getTime())) {
    return { ok: false, error: 'SLOT_NOT_AVAILABLE' };
  }

  const holdVersion = new Types.ObjectId().toString();

  const slot = await SlotModel.findOneAndUpdate(
    {
      businessId,
      providerId,
      providerType,
      serviceId,
      datetime: parsedDatetime,
      status: 'available',
    },
    {
      status: 'held',
      holdVersion,
    },
    { new: true },
  )
    .select({ _id: 1 })
    .lean();

  if (slot) {
    const slotId = String(slot._id);

    emitSlotUpdate(businessId, {
      slotId,
      status: 'held',
    });

    return {
      ok: true,
      slotId,
      holdVersion,
    };
  }

  const heldSlot = await SlotModel.findOne({
    businessId,
    providerId,
    providerType,
    serviceId,
    datetime: parsedDatetime,
    status: 'held',
  })
    .select({ _id: 1, holdVersion: 1 })
    .lean();

  if (heldSlot?.holdVersion) {
    return {
      ok: false,
      error: 'SLOT_HELD',
      slotId: String(heldSlot._id),
      holdVersion: heldSlot.holdVersion,
    };
  }

  return {
    ok: false,
    error: 'SLOT_NOT_AVAILABLE',
  };
}

/**
 * Releases one held slot back to available, gated on the exact
 * holdVersion observed — never on status alone — so this can never
 * release a hold that's already moved on (expired-then-reclaimed, or
 * already confirmed) to a different holdVersion. This is the write
 * side of the claim-triggered lazy release: the caller checks Redis
 * for that holdVersion's key first, and only calls this when it's
 * missing, then retries the claim.
 *
 * businessId for the realtime push is read off the matched document
 * rather than taken as a parameter — the caller only needs to know
 * slotId/holdVersion/its own Redis hold, not reach back into Slots'
 * data to supply something this module already has.
 */
export async function releaseHeldSlot(
  slotId: string,
  holdVersion: string,
): Promise<boolean> {
  if (!Types.ObjectId.isValid(slotId)) {
    return false;
  }

  const slot = await SlotModel.findOneAndUpdate(
    {
      _id: slotId,
      status: 'held',
      holdVersion,
    },
    {
      $set: {
        status: 'available',
      },
      $unset: {
        holdVersion: 1,
      },
    },
    {
      new: false,
    },
  )
    .select({ _id: 1, businessId: 1 })
    .lean();

  if (!slot) {
    return false;
  }

  emitSlotUpdate(String(slot.businessId), {
    slotId,
    status: 'available',
  });

  return true;
}
export async function confirmHeldSlot(
  slotId: string,
  businessId: string,
  holdVersion: string,
  session: ClientSession,
): Promise<boolean> {
  if (!Types.ObjectId.isValid(slotId)) {
    return false;
  }

  const slot = await SlotModel.findOneAndUpdate(
    {
      _id: slotId,
      businessId,
      status: 'held',
      holdVersion,
    },
    {
      $set: {
        status: 'confirmed',
      },
      $unset: {
        holdVersion: 1,
      },
    },
    {
      session,
      new: true,
    },
  )
    .select({ _id: 1 })
    .lean();

  return Boolean(slot);
}

