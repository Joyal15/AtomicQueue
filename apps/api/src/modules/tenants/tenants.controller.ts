import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';

import { requireUser } from '../../lib/requireUser.js';
import { requireRole } from '../../lib/requireRole.js';

import { getBusinessById, updateBusiness } from './tenants.service.js';

export const getTenantsStatus: RequestHandler = (req, res) => {
  res.json({
    data: {
      module: 'tenants',
      status: 'skeleton',
    },
  });
};

/**
 * Body schema for PATCH / (the business update route). Every field is
 * optional (partial update), but at least one must be present — an
 * empty body is a caller error, not a silent no-op.
 */
export const updateBusinessSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required.').optional(),
    timezone: z.string().trim().min(1, 'Timezone is required.').optional(),
    cancellationCutoffMinutes: z
      .number()
      .int('Cutoff must be a whole number of minutes.')
      .min(0, 'Cutoff cannot be negative.')
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update.',
  });

/**
 * Handles the HTTP request for viewing the authenticated user's own
 * business.
 *
 * Any authenticated user (owner or staff) can view it — no owner-only
 * restriction on the read side.
 */
export async function getMyBusinessController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!requireUser(req, res)) return;

  try {
    const business = await getBusinessById(req.user.businessId);

    if (!business) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Business not found',
        },
      });
    }

    return res.status(200).json({
      data: business,
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * Handles the HTTP request for updating the authenticated business's
 * editable settings (name, timezone, cancellation cutoff).
 *
 * Owner-only: changing business-wide policy is an owner decision.
 */
export async function updateMyBusinessController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!requireUser(req, res)) return;
  if (!requireRole(req, res, 'owner')) return;

  try {
    const business = await updateBusiness({
      businessId: req.user.businessId,
      name: req.body.name,
      timezone: req.body.timezone,
      cancellationCutoffMinutes: req.body.cancellationCutoffMinutes,
    });

    if (!business) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Business not found',
        },
      });
    }

    return res.status(200).json({
      data: business,
    });
  } catch (error) {
    return next(error);
  }
}
