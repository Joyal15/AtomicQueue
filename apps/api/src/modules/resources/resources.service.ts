import { Types } from 'mongoose';

import type { Resource } from '@queueless/shared-types';

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
 */
export interface UpdateResourceInput {
  businessId: string;
  resourceId: string;
  name?: string;
  type?: string;
  capacity?: number;
  status?: 'active' | 'removed';
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

  if (input.status !== undefined) {
    updates.status = input.status;
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
 * Retires a resource by marking it removed instead of deleting it,
 * since existing bookings may still reference it.
 */
export async function removeResource(
  businessId: string,
  resourceId: string,
): Promise<Resource | null> {
  const resource = await ResourceModel.findOneAndUpdate(
    {
      _id: resourceId,
      businessId,
    },
    {
      status: 'removed',
    },
    {
      new: true,
    },
  );

  if (!resource) {
    return null;
  }

  return toResource(resource);
}