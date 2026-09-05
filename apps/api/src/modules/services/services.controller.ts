import { z } from 'zod';

import { asyncHandler } from '../../lib/asyncHandler.js';
import { requireUser } from '../../lib/requireUser.js';

import {
  createService,
  getServices,
  getServiceById,
  updateService,
  deactivateService,
  reactivateService,
} from './services.service.js';

/** Body schema for POST /, enforced by `validate()` at the router level. */
export const createServiceSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.'),
  durationMinutes: z
    .number()
    .int('Duration must be a whole number of minutes.')
    .min(1, 'Duration must be at least 1 minute.'),
  price: z.number().min(0, 'Price cannot be negative.'),
});

/**
 * Body schema for PATCH /:serviceId. Every field is optional (partial
 * update — Mongoose already drops undefined keys from the write, this
 * just makes that contract explicit and rejects a genuinely empty body).
 *
 * `isActive` is deliberately not accepted here — deactivating/
 * reactivating a service must go through `PATCH .../deactivate` or
 * `.../reactivate` so the deactivation cascade can never be bypassed
 * by a plain field patch.
 */
export const updateServiceSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required.').optional(),
    durationMinutes: z
      .number()
      .int('Duration must be a whole number of minutes.')
      .min(1, 'Duration must be at least 1 minute.')
      .optional(),
    price: z.number().min(0, 'Price cannot be negative.').optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update.',
  });

/**
 * Creates a service. businessId comes from the session, not the request body.
 */
export const createServiceController = asyncHandler(async (req, res) => {
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
});

/**
 * Gets all services for the authenticated business.
 */
export const getServicesController = asyncHandler(async (req, res) => {
  if (!requireUser(req, res)) return;

  const services = await getServices(
    req.user.businessId,
  );

  return res.status(200).json({
    data: services,
  });
});

/**
 * Gets one service by ID, scoped to the authenticated business.
 */
export const getServiceByIdController = asyncHandler<{ serviceId: string }>(
  async (req, res) => {
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
  },
);

/**
 * Updates a service.
 */
export const updateServiceController = asyncHandler<{ serviceId: string }>(
  async (req, res) => {
    if (!requireUser(req, res)) return;

    const service = await updateService({
      businessId: req.user.businessId,
      serviceId: req.params.serviceId,
      name: req.body.name,
      durationMinutes: req.body.durationMinutes,
      price: req.body.price,
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
  },
);

/**
 * Deactivates a service: transactional cascade (architecture doc §2c) —
 * marks it inactive, blocks its future available slots, cancels its
 * future held slots, and deletes its availability templates. Confirmed
 * future bookings are deliberately left untouched.
 */
export const deactivateServiceController = asyncHandler<{ serviceId: string }>(
  async (req, res) => {
    if (!requireUser(req, res)) return;

    const service = await deactivateService(
      req.user.businessId,
      req.params.serviceId,
    );

    if (!service) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Service not found or already inactive',
        },
      });
    }

    return res.status(200).json({
      data: service,
    });
  },
);

/**
 * Reactivates a previously deactivated service. Explicit,
 * non-cascading — resurrects nothing (no un-blocking specific slots,
 * no restored availability templates).
 */
export const reactivateServiceController = asyncHandler<{ serviceId: string }>(
  async (req, res) => {
    if (!requireUser(req, res)) return;

    const service = await reactivateService(
      req.user.businessId,
      req.params.serviceId,
    );

    if (!service) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Service not found or already active',
        },
      });
    }

    return res.status(200).json({
      data: service,
    });
  },
);
