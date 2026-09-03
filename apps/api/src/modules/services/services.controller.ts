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
 * Handles the HTTP request for creating a new service.
 *
 * The controller gets the business ID from the authenticated user
 * and gets the service information from the request body.
 *
 * The businessId must NEVER come from the client request body because
 * that could allow a user to create a service for another business.
 *
 * The authenticated user's businessId is trusted because it was
 * established by the authentication middleware.
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
 * Handles the HTTP request for getting all services
 * belonging to the authenticated business.
 *
 * The business ID comes from the authenticated user's session,
 * not from the request body or query parameters.
 *
 * This ensures that a user can only retrieve services belonging
 * to their own business.
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
 * Handles the HTTP request for getting one service.
 *
 * The serviceId identifies the service we want.
 *
 * The businessId comes from the authenticated user and ensures
 * that the lookup is restricted to the user's own business.
 *
 * Returns 404 when the service does not exist or does not belong
 * to the authenticated business.
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

  // The service does not exist or does not belong
  // to the authenticated user's business.
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
 * Handles the HTTP request for updating a service.
 *
 * The serviceId comes from the URL.
 *
 * The businessId comes from the authenticated user.
 *
 * The new service information comes from the request body.
 *
 * The service layer makes sure the service belongs to the
 * authenticated business before changing it.
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

  // The service either does not exist or does not belong
  // to the authenticated user's business.
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
 * Handles the HTTP request for deactivating a service.
 *
 * We do not permanently delete the service. Instead, the service
 * is marked as inactive so existing bookings and slots can keep
 * their historical reference to it.
 *
 * The businessId comes from the authenticated user.
 *
 * Returns 404 if the service does not exist or does not belong
 * to the authenticated user's business.
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

  // The service was not found for this business.
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