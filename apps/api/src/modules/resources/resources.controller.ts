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
 * Handles the HTTP request for creating a new resource.
 *
 * The business ID comes from the authenticated user's session.
 *
 * The resource information comes from the request body.
 *
 * This prevents a client from choosing another business's
 * businessId when creating a resource.
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
 * Handles the HTTP request for getting all resources
 * belonging to the authenticated business.
 *
 * The business ID comes from the authenticated user's session.
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
 * Handles the HTTP request for getting one resource.
 *
 * The resourceId comes from the URL.
 *
 * The businessId comes from the authenticated user so that
 * the lookup is restricted to the user's own business.
 *
 * Returns 404 when the resource does not exist or does not
 * belong to the authenticated business.
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

  // The resource does not exist or does not belong
  // to the authenticated user's business.
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
 * Handles the HTTP request for updating a resource.
 *
 * The resourceId comes from the URL.
 *
 * The businessId comes from the authenticated user.
 *
 * The updated resource information comes from the request body.
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

  // The resource either does not exist or does not belong
  // to the authenticated user's business.
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
 * Handles the HTTP request for removing a resource.
 *
 * We do not permanently delete the resource.
 *
 * Instead, the resource is marked as "removed" so existing
 * bookings and historical records can continue to reference it.
 *
 * The businessId comes from the authenticated user's session.
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

  // The resource was not found for this business.
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