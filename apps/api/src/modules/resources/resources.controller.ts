import { z } from 'zod';

import { asyncHandler } from '../../lib/asyncHandler.js';
import { requireUser } from '../../lib/requireUser.js';

import {
  createResource,
  getResources,
  getResourceById,
  updateResource,
  removeResource,
} from './resources.service.js';

/** Body schema for POST /, enforced by `validate()` at the router level. */
export const createResourceSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.'),
  type: z.string().trim().min(1, 'Type is required.'),
  capacity: z
    .number()
    .int('Capacity must be a whole number.')
    .min(1, 'Capacity must be at least 1.'),
});

/**
 * Body schema for PATCH /:resourceId. Every field is optional (partial
 * update), but at least one must be present.
 */
export const updateResourceSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required.').optional(),
    type: z.string().trim().min(1, 'Type is required.').optional(),
    capacity: z
      .number()
      .int('Capacity must be a whole number.')
      .min(1, 'Capacity must be at least 1.')
      .optional(),
    status: z.enum(['active', 'removed']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update.',
  });

/**
 * Creates a resource. businessId comes from the session, not the request body.
 */
export const createResourceController = asyncHandler(async (req, res) => {
  if (!requireUser(req, res)) return;

  const resource = await createResource({
    businessId: req.user.businessId,
    name: req.body.name,
    type: req.body.type,
    capacity: req.body.capacity,
  });

  return res.status(201).json({
    data: resource,
  });
});

/**
 * Gets all resources for the authenticated business.
 */
export const getResourcesController = asyncHandler(async (req, res) => {
  if (!requireUser(req, res)) return;

  const resources = await getResources(
    req.user.businessId,
  );

  return res.status(200).json({
    data: resources,
  });
});

/**
 * Gets one resource by ID, scoped to the authenticated business.
 */
export const getResourceByIdController = asyncHandler<{ resourceId: string }>(
  async (req, res) => {
    if (!requireUser(req, res)) return;

    const resource = await getResourceById(
      req.user.businessId,
      req.params.resourceId,
    );

    if (!resource) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Resource not found',
        },
      });
    }

    return res.status(200).json({
      data: resource,
    });
  },
);

/**
 * Updates a resource.
 */
export const updateResourceController = asyncHandler<{ resourceId: string }>(
  async (req, res) => {
    if (!requireUser(req, res)) return;

    const resource = await updateResource({
      businessId: req.user.businessId,
      resourceId: req.params.resourceId,
      name: req.body.name,
      type: req.body.type,
      capacity: req.body.capacity,
      status: req.body.status,
    });

    if (!resource) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Resource not found',
        },
      });
    }

    return res.status(200).json({
      data: resource,
    });
  },
);

/**
 * Marks a resource as removed rather than deleting it, so existing
 * bookings can still reference it.
 */
export const removeResourceController = asyncHandler<{ resourceId: string }>(
  async (req, res) => {
    if (!requireUser(req, res)) return;

    const resource = await removeResource(
      req.user.businessId,
      req.params.resourceId,
    );

    if (!resource) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Resource not found',
        },
      });
    }

    return res.status(200).json({
      data: resource,
    });
  },
);
