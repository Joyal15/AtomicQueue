import type { Request, Response } from 'express';

import { requireUser } from '../../lib/requireUser.js';

import {
  createResource,
  getResources,
  getResourceById,
  updateResource,
  removeResource,
} from './resources.service.js';

/**
 * Creates a resource. businessId comes from the session, not the request body.
 */
export async function createResourceController(
  req: Request,
  res: Response,
) {
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
}

/**
 * Gets all resources for the authenticated business.
 */
export async function getResourcesController(
  req: Request,
  res: Response,
) {
  if (!requireUser(req, res)) return;

  const resources = await getResources(
    req.user.businessId,
  );

  return res.status(200).json({
    data: resources,
  });
}

/**
 * Gets one resource by ID, scoped to the authenticated business.
 */
export async function getResourceByIdController(
  req: Request<{ resourceId: string }>,
  res: Response,
) {
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
}

/**
 * Updates a resource.
 */
export async function updateResourceController(
  req: Request<{ resourceId: string }>,
  res: Response,
) {
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
}

/**
 * Marks a resource as removed rather than deleting it, so existing
 * bookings can still reference it.
 */
export async function removeResourceController(
  req: Request<{ resourceId: string }>,
  res: Response,
) {
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
}