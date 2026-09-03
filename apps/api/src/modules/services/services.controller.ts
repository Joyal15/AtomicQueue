import type { Request, Response } from 'express';

import { requireUser } from '../../lib/requireUser.js';

import {
  createService,
  getServices,
  getServiceById,
  updateService,
  deactivateService,
} from './services.service.js';

/**
 * Creates a service. businessId comes from the session, not the request body.
 */
export async function createServiceController(
  req: Request,
  res: Response,
) {
  if (!requireUser(req, res)) return;

  const service = await createService({
    businessId: req.user.businessId,
    name: req.body.name,
    durationMinutes: req.body.durationMinutes,
    price: req.body.price,
  });

  return res.status(201).json({
    data: service,
  });
}

/**
 * Gets all services for the authenticated business.
 */
export async function getServicesController(
  req: Request,
  res: Response,
) {
  if (!requireUser(req, res)) return;

  const services = await getServices(
    req.user.businessId,
  );

  return res.status(200).json({
    data: services,
  });
}

/**
 * Gets one service by ID, scoped to the authenticated business.
 */
export async function getServiceByIdController(
  req: Request<{ serviceId: string }>,
  res: Response,
) {
  if (!requireUser(req, res)) return;

  const service = await getServiceById(
    req.user.businessId,
    req.params.serviceId,
  );

  if (!service) {
    return res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Service not found',
      },
    });
  }

  return res.status(200).json({
    data: service,
  });
}

/**
 * Updates a service.
 */
export async function updateServiceController(
  req: Request<{ serviceId: string }>,
  res: Response,
) {
  if (!requireUser(req, res)) return;

  const service = await updateService({
    businessId: req.user.businessId,
    serviceId: req.params.serviceId,
    name: req.body.name,
    durationMinutes: req.body.durationMinutes,
    price: req.body.price,
    isActive: req.body.isActive,
  });

  if (!service) {
    return res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Service not found',
      },
    });
  }

  return res.status(200).json({
    data: service,
  });
}

/**
 * Marks a service inactive rather than deleting it, so existing
 * bookings and slots can still reference it.
 */
export async function deactivateServiceController(
  req: Request<{ serviceId: string }>,
  res: Response,
) {
  if (!requireUser(req, res)) return;

  const service = await deactivateService(
    req.user.businessId,
    req.params.serviceId,
  );

  if (!service) {
    return res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Service not found',
      },
    });
  }

  return res.status(200).json({
    data: service,
  });
}