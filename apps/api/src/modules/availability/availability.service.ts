/**
 * Service layer for the Availability module.
 *
 * All reads and writes of `ProviderAvailability` go through here.
 * Controllers call these functions; other modules call them via
 * `./index.ts`. Nothing outside this file touches the model.
 *
 * Responsibilities:
 *   - Enforce tenant scoping — every query is filtered by the
 *     caller-supplied `businessId` (which the controller takes from
 *     the session, never the request body).
 *   - Validate the referenced `serviceId` on every write path:
 *     it must resolve to a service owned by the same business and
 *     be active (architecture doc Section 2b / 2c).
 *   - Map Mongo documents to the shared `ProviderAvailability` API
 *     type so the DB shape never leaks out of the module.
 *
 *   - Validate the referenced `providerId` / `providerType` on
 *     create by delegating to the `providers` module's centralized
 *     `validateProvider` — same-business, active, and (for staff)
 *     provider-eligible (architecture doc Section 2b).
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
 * Reasons a write to provider availability can be rejected before
 * it touches the database.
 *
 * SERVICE_NOT_FOUND  - the serviceId does not resolve to a service
 *                      owned by the caller's business.
 * SERVICE_INACTIVE   - the service exists but has been deactivated,
 *                      so no new availability may be generated
 *                      against it (architecture doc Section 2c).
 * PROVIDER_NOT_FOUND / PROVIDER_REMOVED / PROVIDER_INELIGIBLE -
 *                      passed straight through from the `providers`
 *                      module's `validateProvider` (architecture
 *                      doc Section 2b).
 * AVAILABILITY_NOT_FOUND - the availability row being updated does
 *                      not exist for the caller's business.
 */
export type AvailabilityWriteError =
  | 'SERVICE_NOT_FOUND'
  | 'SERVICE_INACTIVE'
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_REMOVED'
  | 'PROVIDER_INELIGIBLE'
  | 'AVAILABILITY_NOT_FOUND';

/**
 * Discriminated result for the write paths that validate a
 * referenced service. The service layer never throws for these
 * expected, caller-facing outcomes — the controller maps the
 * `error` value onto the right HTTP status.
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
 *
 * The mapper works off this Mongo document shape (including the
 * Mongo sub-document window type via ProviderAvailabilityDocument),
 * not the public API type, so the two contracts stay independent.
 */
type ProviderAvailabilityRecord = ProviderAvailabilityDocument & {
  _id: Types.ObjectId;
};

/**
 * Converts a MongoDB availability document into the shared API type.
 *
 * We explicitly return only the fields required by the
 * ProviderAvailability contract.
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
 * Validates that a serviceId references a service that belongs to
 * the caller's business and is currently active.
 *
 * Returns the matching write error, or null when the service is
 * usable. Availability templates must never be created or repointed
 * against another business's service or a deactivated one
 * (architecture doc Section 2b/2c).
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
 * Guards the id-taking read/update/delete paths against a malformed
 * availabilityId. A non-ObjectId string would otherwise make the
 * Mongo query throw a CastError (surfacing as a 500) instead of the
 * intended "not found" outcome.
 */
function isValidAvailabilityId(id: string): boolean {
  return Types.ObjectId.isValid(id);
}

/**
 * Creates a provider availability row for a business.
 *
 * The businessId is supplied by the authenticated user's session
 * at the controller layer, never by the client body.
 *
 * Both references are validated before the row is written:
 *   - the provider, via the `providers` module's centralized
 *     `validateProvider` (same-business, active, staff-eligible),
 *   - the service, via `validateService` (same-business, active),
 * so a template can never be generated against a provider or a
 * service the business does not own or has turned off.
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
 * The query includes businessId so a row from another business
 * cannot be modified through this function. When the update
 * repoints the row at a different service, that new service is
 * validated the same way creation validates it.
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
 * Availability templates carry no historical value once removed,
 * so unlike resources they are hard-deleted.
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
