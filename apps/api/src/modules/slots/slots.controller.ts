/**
 * HTTP controllers for the Slots module.
 *
 * `generate` is owner-only — it's a real (if manually-triggered, for
 * now) write that produces potentially many documents; `list` is any
 * authenticated staff/owner, matching the `availability` module's own
 * read-access pattern.
 *
 * Every handler wraps its body in try/catch + next(error): Express
 * here is ^4.21.2, which does not auto-catch a rejected promise from
 * an async handler, and there is no asyncHandler/wrapper utility in
 * this codebase (same discipline as every other controller).
 */

import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

import type { ProviderType } from '@queueless/shared-types';

import { requireUser } from '../../lib/requireUser.js';
import { requireRole } from '../../lib/requireRole.js';

import { generateWeeklySlots, listSlots } from './slots.service.js';

/**
 * Body schema for POST /generate, enforced by `validate()`
 * (`middleware/validate.ts`) at the router level. `days` is bounds-
 * checked so an owner can't accidentally trigger a huge generation
 * window.
 */
export const generateSlotsSchema = z.object({
  days: z.number().int().min(1).max(30).optional(),
});

/**
 * Handles POST /api/slots/generate — runs `generate-weekly-slots`
 * (architecture doc Section 6) for the authenticated owner's own
 * business.
 */
export async function generateSlotsController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!requireUser(req, res)) return;
  if (!requireRole(req, res, 'owner')) return;

  try {
    const result = await generateWeeklySlots(req.user.businessId, {
      days: req.body?.days,
    });

    return res.status(201).json({ data: result });
  } catch (error) {
    return next(error);
  }
}

function parseProviderType(value: unknown): ProviderType | undefined {
  return value === 'staff' || value === 'resource' ? value : undefined;
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Handles GET /api/slots — lists the authenticated business's slots,
 * optionally narrowed by providerId/providerType/from/to. Any
 * authenticated staff/owner, no role restriction (matches
 * `availability`'s own read-access pattern).
 */
export async function listSlotsController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!requireUser(req, res)) return;

  try {
    const slots = await listSlots(req.user.businessId, {
      providerId:
        typeof req.query.providerId === 'string'
          ? req.query.providerId
          : undefined,
      providerType: parseProviderType(req.query.providerType),
      from: parseDate(req.query.from),
      to: parseDate(req.query.to),
    });

    return res.status(200).json({ data: slots });
  } catch (error) {
    return next(error);
  }
}
