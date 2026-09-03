/**
 * Service layer for the Availability module.
 *
 * All reads and writes of `ProviderAvailability` go through here. Other
 * modules call in via `./index.ts`.
 *
 * Responsibilities:
 *   - Enforce tenant scoping on every query via the caller-supplied
 *     `businessId`.
 *   - Validate the referenced `serviceId` on every write path: it must
 *     belong to the same business and be active.
 *   - Validate `providerId`/`providerType` on create via the `providers`
 *     module's `validateProvider` (same-business, active, eligible).
 *   - Map Mongo documents to the shared `ProviderAvailability` API type.
 */

import { Types } from 'mongoose';

import type {
  ProviderAvailability,
  ProviderType,
  WeeklyAvailabilityWindow,
} from '@queueless/shared-types';

import { validateProvider } from '../providers/index.js';
import { getServiceById } from '../services/index.js';

import {
  ProviderAvailabilityModel,
  type ProviderAvailabilityDocument,
} from './availability.model.js';

/**
 * Reasons a write to provider availability can be rejected before it
 * touches the database.
 *
 * SERVICE_NOT_FOUND  - serviceId doesn't resolve to a service owned by
 *                      the caller's business.
 * SERVICE_INACTIVE   - the service exists but is deactivated.
 * PROVIDER_NOT_FOUND / PROVIDER_REMOVED / PROVIDER_INELIGIBLE -
 *                      passed through from `providers` module's
 *                      `validateProvider`.
 * AVAILABILITY_NOT_FOUND - the row being updated doesn't exist for the
 *                      caller's business.
 */
export type AvailabilityWriteError =
  | 'SERVICE_NOT_FOUND'
  | 'SERVICE_INACTIVE'
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_REMOVED'
  | 'PROVIDER_INELIGIBLE'
  | 'AVAILABILITY_NOT_FOUND';

/**
 * Discriminated result for write paths that validate a referenced
 * service. The controller maps the `error` value onto an HTTP status.
 */
export type AvailabilityWriteResult =
  | { ok: true; availability: ProviderAvailability }
  | { ok: false; error: AvailabilityWriteError };

/**
 * Input required to create a provider availability row.
 */
export interface CreateAvailabilityInput {
  businessId: string;
  providerId: string;
  providerType: ProviderType;
  serviceId: string;
  weeklyWindows: WeeklyAvailabilityWindow[];
}

/**
 * A hydrated availability document as read back from Mongoose.
 */
type ProviderAvailabilityRecord = ProviderAvailabilityDocument & {
  _id: Types.ObjectId;
};

/**
 * Converts a MongoDB availability document into the shared API type.
 */
function toProviderAvailability(
  availability: ProviderAvailabilityRecord,
): ProviderAvailability {
  return {
    id: availability._id.toString(),
    businessId: availability.businessId,
    providerId: availability.providerId,
    providerType: availability.providerType,
    serviceId: availability.serviceId,
    weeklyWindows: availability.weeklyWindows.map((window) => ({
      dayOfWeek: window.dayOfWeek,
      startTime: window.startTime,
      endTime: window.endTime,
    })),
  };
}

/**
 * Validates that a serviceId belongs to the caller's business and is
 * currently active. Returns the matching write error, or null if usable.
 */
async function validateService(
  businessId: string,
  serviceId: string,
): Promise<'SERVICE_NOT_FOUND' | 'SERVICE_INACTIVE' | null> {
  const service = await getServiceById(businessId, serviceId);

  if (!service) {
    return 'SERVICE_NOT_FOUND';
  }

  if (!service.isActive) {
    return 'SERVICE_INACTIVE';
  }

  return null;
}

/**
 * Guards read/update/delete against a malformed availabilityId — a
 * non-ObjectId string would otherwise throw a CastError instead of a
 * clean "not found".
 */
function isValidAvailabilityId(id: string): boolean {
  return Types.ObjectId.isValid(id);
}

/**
 * Creates a provider availability row for a business.
 *
 * Validates both references before writing: the provider via
 * `validateProvider` (same-business, active, staff-eligible) and the
 * service via `validateService` (same-business, active).
 */
export async function createAvailability(
  input: CreateAvailabilityInput,
): Promise<AvailabilityWriteResult> {
  const providerResult = await validateProvider(
    input.businessId,
    input.providerId,
    input.providerType,
  );

  if (!providerResult.ok) {
    return { ok: false, error: providerResult.error };
  }

  const serviceError = await validateService(
    input.businessId,
    input.serviceId,
  );

  if (serviceError) {
    return { ok: false, error: serviceError };
  }

  const availability = await ProviderAvailabilityModel.create({
    businessId: input.businessId,
    providerId: input.providerId,
    providerType: input.providerType,
    serviceId: input.serviceId,
    weeklyWindows: input.weeklyWindows,
  });

  return {
    ok: true,
    availability: toProviderAvailability(availability),
  };
}

/**
 * Returns all availability rows belonging to a business.
 *
 * Optionally filters by providerId and/or serviceId.
 */
export async function getAvailability(
  businessId: string,
  filter: { providerId?: string; serviceId?: string } = {},
): Promise<ProviderAvailability[]> {
  const query: Record<string, unknown> = { businessId };

  if (filter.providerId !== undefined) {
    query.providerId = filter.providerId;
  }

  if (filter.serviceId !== undefined) {
    query.serviceId = filter.serviceId;
  }

  const rows = await ProviderAvailabilityModel.find(query);

  return rows.map(toProviderAvailability);
}

/**
 * Returns one availability row belonging to a business.
 *
 * Returning null means the row either does not exist or does not
 * belong to the supplied business.
 */
export async function getAvailabilityById(
  businessId: string,
  availabilityId: string,
): Promise<ProviderAvailability | null> {
  if (!isValidAvailabilityId(availabilityId)) {
    return null;
  }

  const availability = await ProviderAvailabilityModel.findOne({
    _id: availabilityId,
    businessId,
  });

  if (!availability) {
    return null;
  }

  return toProviderAvailability(availability);
}

/**
 * Input required to update a provider availability row.
 *
 * All fields except the identifiers are optional because the
 * endpoint supports partial updates.
 */
export interface UpdateAvailabilityInput {
  businessId: string;
  availabilityId: string;
  serviceId?: string;
  weeklyWindows?: WeeklyAvailabilityWindow[];
}

/**
 * Updates an availability row belonging to a business.
 *
 * The query includes businessId so another business's row can't be
 * modified. Repointing to a different service re-validates it the same
 * way creation does.
 */
export async function updateAvailability(
  input: UpdateAvailabilityInput,
): Promise<AvailabilityWriteResult> {
  if (!isValidAvailabilityId(input.availabilityId)) {
    return {
      ok: false,
      error: 'AVAILABILITY_NOT_FOUND',
    };
  }

  if (input.serviceId !== undefined) {
    const serviceError = await validateService(
      input.businessId,
      input.serviceId,
    );

    if (serviceError) {
      return { ok: false, error: serviceError };
    }
  }

  const updates: Record<string, unknown> = {};

  if (input.serviceId !== undefined) {
    updates.serviceId = input.serviceId;
  }

  if (input.weeklyWindows !== undefined) {
    updates.weeklyWindows = input.weeklyWindows;
  }

  const availability = await ProviderAvailabilityModel.findOneAndUpdate(
    {
      _id: input.availabilityId,
      businessId: input.businessId,
    },
    updates,
    {
      new: true,
    },
  );

  if (!availability) {
    return { ok: false, error: 'AVAILABILITY_NOT_FOUND' };
  }

  return {
    ok: true,
    availability: toProviderAvailability(availability),
  };
}

/**
 * Permanently deletes an availability row belonging to a business.
 *
 * Hard-deleted, unlike resources.
 */
export async function removeAvailability(
  businessId: string,
  availabilityId: string,
): Promise<ProviderAvailability | null> {
  if (!isValidAvailabilityId(availabilityId)) {
    return null;
  }

  const availability = await ProviderAvailabilityModel.findOneAndDelete({
    _id: availabilityId,
    businessId,
  });

  if (!availability) {
    return null;
  }

  return toProviderAvailability(availability);
}
