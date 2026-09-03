/**
 * HTTP controllers for the Availability module.
 *
 * These are thin: each handler pulls the tenant identity from
 * `req.user.businessId` (session, never the body), reads inputs
 * from the URL / body / query, delegates to the service layer, and
 * translates the result into the locked response envelope —
 * `{ data }` on success, `{ error: { code, message, ... } }` on
 * failure (architecture doc Section 13).
 *
 * No validation or persistence logic lives here; that belongs in
 * `availability.service.ts`.
 */

import type { Request, Response } from 'express';

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
 * Maps a service-layer write error onto an HTTP response.
 *
 * A bad service reference is the caller's input problem (400); a
 * missing availability row is a 404. The service layer owns the
 * validation — the controller only translates the outcome.
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

  // Everything else is a bad reference in the caller's own body —
  // surface it as a 400 keyed to the offending field.
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
 * The businessId comes from the authenticated user's session and is
 * never read from the request body, so a client cannot create
 * availability for another business.
 */
export async function createAvailabilityController(
  req: Request,
  res: Response,
) {
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
}

/**
 * Handles the HTTP request for listing availability rows
 * belonging to the authenticated business.
 *
 * Supports optional providerId and serviceId query filters.
 */
export async function getAvailabilityController(
  req: Request,
  res: Response,
) {
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
}

/**
 * Handles the HTTP request for getting one availability row.
 *
 * The availabilityId comes from the URL. The businessId comes from
 * the authenticated user so the lookup is scoped to their business.
 *
 * Returns 404 when the row does not exist or does not belong to
 * the authenticated business.
 */
export async function getAvailabilityByIdController(
  req: Request<{ availabilityId: string }>,
  res: Response,
) {
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
}

/**
 * Handles the HTTP request for updating an availability row.
 *
 * The availabilityId comes from the URL. The businessId comes from
 * the authenticated user. The updated fields come from the body.
 */
export async function updateAvailabilityController(
  req: Request<{ availabilityId: string }>,
  res: Response,
) {
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
}

/**
 * Handles the HTTP request for removing an availability row.
 *
 * The availabilityId comes from the URL. The businessId comes from
 * the authenticated user's session.
 */
export async function removeAvailabilityController(
  req: Request<{ availabilityId: string }>,
  res: Response,
) {
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
}
