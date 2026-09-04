import type { NextFunction, Request, Response } from 'express';

import { requireUser } from '../../lib/requireUser.js';

import { joinWaitlist, listWaitlist } from './waitlist.service.js';

/**
 * Handles POST /api/waitlist — a customer opts in to be notified when
 * a taken slot opens up. Public/unauthenticated (architecture doc
 * §13a): reached straight from the public booking page, no session.
 */
export async function joinWaitlistController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { businessId, customer, desiredServiceId, desiredProviderId } =
      req.body;

    if (
      typeof businessId !== 'string' ||
      !businessId ||
      typeof desiredServiceId !== 'string' ||
      !desiredServiceId ||
      typeof customer !== 'object' ||
      customer === null ||
      typeof customer.name !== 'string' ||
      typeof customer.contact !== 'string'
    ) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message:
            'businessId, desiredServiceId, and customer{name,contact} are required.',
        },
      });
      return;
    }

    const entry = await joinWaitlist({
      businessId,
      customer: { name: customer.name, contact: customer.contact },
      desiredServiceId,
      desiredProviderId:
        typeof desiredProviderId === 'string' ? desiredProviderId : undefined,
    });

    res.status(201).json({ data: entry });
  } catch (error) {
    next(error);
  }
}

/**
 * Handles GET /api/waitlist — staff/owner dashboard view of active
 * (waiting/notified) entries for their own business.
 */
export async function listWaitlistController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!requireUser(req, res)) return;

  try {
    const entries = await listWaitlist(req.user.businessId);
    res.status(200).json({ data: entries });
  } catch (error) {
    next(error);
  }
}
