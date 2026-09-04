import { z } from 'zod';

import { asyncHandler } from '../../lib/asyncHandler.js';
import { requireUser } from '../../lib/requireUser.js';

import { joinWaitlist, listWaitlist } from './waitlist.service.js';

/** Body schema for POST /, enforced by `validate()` at the router level. */
export const joinWaitlistSchema = z.object({
  businessId: z.string().trim().min(1, 'Business is required.'),
  desiredServiceId: z.string().trim().min(1, 'Service is required.'),
  desiredProviderId: z.string().trim().min(1).optional(),
  customer: z.object({
    name: z.string().trim().min(1, 'Name is required.'),
    contact: z.string().trim().min(1, 'Contact is required.'),
  }),
});

/**
 * Handles POST /api/waitlist — a customer opts in to be notified when
 * a taken slot opens up. Public/unauthenticated (architecture doc
 * §13a): reached straight from the public booking page, no session.
 */
export const joinWaitlistController = asyncHandler(async (req, res) => {
  const { businessId, customer, desiredServiceId, desiredProviderId } =
    req.body;

  const entry = await joinWaitlist({
    businessId,
    customer: { name: customer.name, contact: customer.contact },
    desiredServiceId,
    desiredProviderId,
  });

  res.status(201).json({ data: entry });
});

/**
 * Handles GET /api/waitlist — staff/owner dashboard view of active
 * (waiting/notified) entries for their own business.
 */
export const listWaitlistController = asyncHandler(async (req, res) => {
  if (!requireUser(req, res)) return;

  const entries = await listWaitlist(req.user.businessId);
  res.status(200).json({ data: entries });
});
