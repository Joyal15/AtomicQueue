/**
 * HTTP controllers for the Availability module.
 *
 * Each handler pulls the tenant identity from `req.user.businessId`
 * (session, never the body), delegates to the service layer, and returns
 * `{ data }` on success or `{ error: { code, message, ... } }` on failure.
 * No validation or persistence logic lives here.
 */

import type { Response } from 'express';
import { z } from 'zod';

import { asyncHandler } from '../../lib/asyncHandler.js';
import { requireUser } from '../../lib/requireUser.js';

import {
  createAvailability,
  getAvailability,
  getAvailabilityById,
  updateAvailability,
  removeAvailability,
  type AvailabilityWriteError,
} from './availability.service.js';

/**
 * Business-local "HH:mm" wall-clock time, e.g. "09:00" or "17:30" — see
 * `availability.model.ts`'s `WeeklyAvailabilityWindowDocument`.
 */
const timeString = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Use 24-hour "HH:mm" format.');

const weeklyWindowSchema = z.object({
  dayOfWeek: z
    .number()
    .int('Day of week must be a whole number.')
    .min(0, 'Day of week must be between 0 (Sunday) and 6 (Saturday).')
    .max(6, 'Day of week must be between 0 (Sunday) and 6 (Saturday).'),
  startTime: timeString,
  endTime: timeString,
});

/** Body schema for POST /, enforced by `validate()` at the router level. */
export const createAvailabilitySchema = z.object({
  providerId: z.string().trim().min(1, 'Provider is required.'),
  providerType: z.enum(['staff', 'resource']),
  serviceId: z.string().trim().min(1, 'Service is required.'),
  weeklyWindows: z.array(weeklyWindowSchema).optional(),
});

/**
 * Body schema for PATCH /:availabilityId. Every field is optional
 * (partial update), but at least one must be present.
 */
export const updateAvailabilitySchema = z
  .object({
    serviceId: z.string().trim().min(1, 'Service is required.').optional(),
    weeklyWindows: z.array(weeklyWindowSchema).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update.',
  });

/**
 * Maps a service-layer write error onto an HTTP response.
 *
 * A bad service reference is the caller's input problem (400); a
 * missing availability row is a 404.
 */
function sendWriteError(
  res: Response,
  error: AvailabilityWriteError,
) {
  if (error === 'AVAILABILITY_NOT_FOUND') {
    return res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Availability not found',
      },
    });
  }

  // Everything else is a bad reference in the caller's own body — surface
  // it as a 400 keyed to the offending field.
  const fields: Record<string, string> = {};

  switch (error) {
    case 'SERVICE_NOT_FOUND':
      fields.serviceId = 'That service does not exist for this business';
      break;
    case 'SERVICE_INACTIVE':
      fields.serviceId = 'That service is inactive';
      break;
    case 'PROVIDER_NOT_FOUND':
      fields.providerId =
        'That provider does not exist for this business';
      break;
    case 'PROVIDER_REMOVED':
      fields.providerId = 'That provider has been removed';
      break;
    case 'PROVIDER_INELIGIBLE':
      fields.providerId =
        'That user is not eligible to act as a provider';
      break;
  }

  return res.status(400).json({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Please check the highlighted fields.',
      fields,
    },
  });
}

/**
 * Handles the HTTP request for creating a provider availability row.
 *
 * businessId comes from the session, not the request body.
 */
export const createAvailabilityController = asyncHandler(async (req, res) => {
  if (!requireUser(req, res)) return;

  const result = await createAvailability({
    businessId: req.user.businessId,
    providerId: req.body.providerId,
    providerType: req.body.providerType,
    serviceId: req.body.serviceId,
    weeklyWindows: req.body.weeklyWindows ?? [],
  });

  if (!result.ok) {
    return sendWriteError(res, result.error);
  }

  return res.status(201).json({
    data: result.availability,
  });
});

/**
 * Handles the HTTP request for listing availability rows
 * belonging to the authenticated business.
 *
 * Supports optional providerId and serviceId query filters.
 */
export const getAvailabilityController = asyncHandler(async (req, res) => {
  if (!requireUser(req, res)) return;

  const availability = await getAvailability(req.user.businessId, {
    providerId:
      typeof req.query.providerId === 'string'
        ? req.query.providerId
        : undefined,
    serviceId:
      typeof req.query.serviceId === 'string'
        ? req.query.serviceId
        : undefined,
  });

  return res.status(200).json({
    data: availability,
  });
});

/**
 * Handles the HTTP request for getting one availability row.
 *
 * The availabilityId comes from the URL. The businessId comes from
 * the authenticated user so the lookup is scoped to their business.
 *
 * Returns 404 when the row does not exist or does not belong to
 * the authenticated business.
 */
export const getAvailabilityByIdController = asyncHandler<{ availabilityId: string }>(
  async (req, res) => {
    if (!requireUser(req, res)) return;

    const availability = await getAvailabilityById(
      req.user.businessId,
      req.params.availabilityId,
    );

    if (!availability) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Availability not found',
        },
      });
    }

    return res.status(200).json({
      data: availability,
    });
  },
);

/**
 * Handles the HTTP request for updating an availability row.
 *
 * The availabilityId comes from the URL. The businessId comes from
 * the authenticated user. The updated fields come from the body.
 */
export const updateAvailabilityController = asyncHandler<{ availabilityId: string }>(
  async (req, res) => {
    if (!requireUser(req, res)) return;

    const result = await updateAvailability({
      businessId: req.user.businessId,
      availabilityId: req.params.availabilityId,
      serviceId: req.body.serviceId,
      weeklyWindows: req.body.weeklyWindows,
    });

    if (!result.ok) {
      return sendWriteError(res, result.error);
    }

    return res.status(200).json({
      data: result.availability,
    });
  },
);

/**
 * Handles the HTTP request for removing an availability row.
 *
 * The availabilityId comes from the URL. The businessId comes from
 * the authenticated user's session.
 */
export const removeAvailabilityController = asyncHandler<{ availabilityId: string }>(
  async (req, res) => {
    if (!requireUser(req, res)) return;

    const availability = await removeAvailability(
      req.user.businessId,
      req.params.availabilityId,
    );

    if (!availability) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Availability not found',
        },
      });
    }

    return res.status(200).json({
      data: availability,
    });
  },
);
