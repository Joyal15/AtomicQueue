import mongoose, { Types, type ClientSession } from 'mongoose';

import type { Resource } from '@queueless/shared-types';

import {
  cancelFutureSlotsForProvider,
  emitBulkSlotUpdates,
  type SlotStatus,
} from '../slots/index.js';
import { removeAvailabilityForProvider } from '../availability/index.js';

import { ResourceModel } from './resources.model.js';

/**
 * Input required to create a new resource.
 */
export interface CreateResourceInput {
  businessId: string;
  name: string;
  type: string;
  capacity: number;
}

/**
 * Converts a MongoDB resource document into the shared API type.
 */
function toResource(resource: {
  _id: Types.ObjectId;
  businessId: string;
  name: string;
  type: string;
  capacity: number;
  status: 'active' | 'removed';
}): Resource {
  return {
    id: resource._id.toString(),
    businessId: resource.businessId,
    name: resource.name,
    type: resource.type,
    capacity: resource.capacity,
    status: resource.status,
  };
}

/**
 * Creates a new resource for a business.
 */
export async function createResource(
  input: CreateResourceInput,
): Promise<Resource> {
  const resource = await ResourceModel.create({
    businessId: input.businessId,
    name: input.name,
    type: input.type,
    capacity: input.capacity,
    status: 'active',
  });

  return toResource(resource);
}

/**
 * Returns all resources belonging to a business.
 */
export async function getResources(
  businessId: string,
): Promise<Resource[]> {
  const resources = await ResourceModel.find({
    businessId,
  }).sort({ name: 1 });

  return resources.map(toResource);
}

/**
 * Returns one resource belonging to a business, or null if it
 * doesn't exist or belongs to a different business.
 */
export async function getResourceById(
  businessId: string,
  resourceId: string,
): Promise<Resource | null> {
  const resource = await ResourceModel.findOne({
    _id: resourceId,
    businessId,
  });

  if (!resource) {
    return null;
  }

  return toResource(resource);
}

/**
 * Input required to update a resource. All fields optional to
 * support partial updates.
 *
 * `status` is deliberately not settable here — retiring/reactivating a
 * resource has to go through `retireResource`/`reactivateResource` so
 * the retirement cascade (architecture doc §9c) can never be bypassed
 * by a plain field patch.
 */
export interface UpdateResourceInput {
  businessId: string;
  resourceId: string;
  name?: string;
  type?: string;
  capacity?: number;
}

/**
 * Updates a resource. Query includes businessId so a resource from
 * another business can't be modified here.
 */
export async function updateResource(
  input: UpdateResourceInput,
): Promise<Resource | null> {
  const updates: Record<string, unknown> = {};

  if (input.name !== undefined) {
    updates.name = input.name;
  }

  if (input.type !== undefined) {
    updates.type = input.type;
  }

  if (input.capacity !== undefined) {
    updates.capacity = input.capacity;
  }

  const resource = await ResourceModel.findOneAndUpdate(
    {
      _id: input.resourceId,
      businessId: input.businessId,
    },
    updates,
    {
      new: true,
    },
  );

  if (!resource) {
    return null;
  }

  return toResource(resource);
}

/**
 * Retires a resource: one transaction, three effects (architecture doc
 * §9c, mirrors staff removal §9b field-for-field):
 *   1. `Resources.status -> 'removed'`
 *   2. This resource's `ProviderAvailability` rows hard-deleted — no
 *      new slots generate against it going forward.
 *   3. Its future `available`/`held` Slots cancelled (`holdVersion`
 *      cleared on the held ones) — a hold on a resource actively being
 *      retired shouldn't be confirmable.
 *
 * Future `confirmed` Slots/Bookings are deliberately left untouched —
 * surfaced elsewhere as a manual follow-up list, never auto-cancelled.
 *
 * Returns `null` if the resource doesn't exist or is already
 * `'removed'` (idempotent no-op, no transaction opened in that case).
 */
export async function retireResource(
  businessId: string,
  resourceId: string,
  dependencies: { mongoSession?: ClientSession } = {},
): Promise<Resource | null> {
  if (!Types.ObjectId.isValid(resourceId)) {
    return null;
  }

  const existing = await ResourceModel.findOne({
    _id: resourceId,
    businessId,
    status: 'active',
  }).lean();

  if (!existing) {
    return null;
  }

  const session = dependencies.mongoSession ?? (await mongoose.startSession());
  const ownsSession = !dependencies.mongoSession;

  try {
    let result: Resource | null = null;
    let affected: { slotId: string; status: SlotStatus }[] = [];

    await session.withTransaction(async () => {
      await removeAvailabilityForProvider(
        businessId,
        resourceId,
        'resource',
        session,
      );

      const slotResult = await cancelFutureSlotsForProvider(
        businessId,
        resourceId,
        'resource',
        session,
      );
      affected = slotResult.affected;

      const resource = await ResourceModel.findOneAndUpdate(
        { _id: resourceId, businessId, status: 'active' },
        { status: 'removed' },
        { session, new: true },
      );

      result = resource ? toResource(resource) : null;
    });

    // Post-commit only — a missed realtime push here is never worth
    // rolling back an otherwise-successful retirement over.
    emitBulkSlotUpdates(businessId, affected);

    return result;
  } finally {
    if (ownsSession) {
      await session.endSession();
    }
  }
}

/**
 * Reactivates a previously retired resource. A separate, explicit,
 * non-cascading action (architecture doc §9c): flips `status` back to
 * `'active'` only. Does not restore the `ProviderAvailability` deleted
 * at retirement — the owner reconfigures availability from scratch,
 * same as setting it up for a brand-new resource.
 *
 * Returns `null` if the resource doesn't exist or isn't currently
 * `'removed'`.
 */
export async function reactivateResource(
  businessId: string,
  resourceId: string,
): Promise<Resource | null> {
  if (!Types.ObjectId.isValid(resourceId)) {
    return null;
  }

  const resource = await ResourceModel.findOneAndUpdate(
    { _id: resourceId, businessId, status: 'removed' },
    { status: 'active' },
    { new: true },
  );

  if (!resource) {
    return null;
  }

  return toResource(resource);
}

/**
 * Retires a resource by marking it removed instead of deleting it,
 * since existing bookings may still reference it.
 *
 * Thin alias over `retireResource` — kept so the existing `DELETE`
 * route continues to work, now backed by the same cascading
 * transaction as the `PATCH .../retire` route instead of a second,
 * non-cascading implementation.
 */
export async function removeResource(
  businessId: string,
  resourceId: string,
): Promise<Resource | null> {
  return retireResource(businessId, resourceId);
}
