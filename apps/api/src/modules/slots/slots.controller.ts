/**
 * HTTP controllers for the Slots module.
 *
 * `generate` is owner-only; `list` allows any authenticated staff/owner.
 * Handlers are wrapped in `asyncHandler` since Express doesn't auto-catch
 * a rejected promise from an async handler.
 */

import { z } from 'zod';

import type { ProviderType, SlotStatus } from '@queueless/shared-types';

const SLOT_STATUSES: readonly SlotStatus[] = [
  'available',
  'held',
  'confirmed',
  'cancelled',
  'blocked',
];

import { asyncHandler } from '../../lib/asyncHandler.js';
import { requireUser } from '../../lib/requireUser.js';
import { requireRole } from '../../lib/requireRole.js';

import { blockSlot, generateWeeklySlots, listSlots } from './slots.service.js';

/**
 * Body schema for POST /generate. `days` is capped so an owner
 * can't accidentally trigger a huge generation window.
 */
export const generateSlotsSchema = z.object({
  days: z.number().int().min(1).max(30).optional(),
});

/**
 * Handles POST /api/slots/generate for the authenticated owner's business.
 */
export const generateSlotsController = asyncHandler(async (req, res) => {
  if (!requireUser(req, res)) return;
  if (!requireRole(req, res, 'owner')) return;

  const result = await generateWeeklySlots(req.user.businessId, {
    days: req.body?.days,
  });

  return res.status(201).json({ data: result });
});

function parseProviderType(value: unknown): ProviderType | undefined {
  return value === 'staff' || value === 'resource' ? value : undefined;
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parseStatus(value: unknown): SlotStatus | undefined {
  return typeof value === 'string' &&
    (SLOT_STATUSES as readonly string[]).includes(value)
    ? (value as SlotStatus)
    : undefined;
}

/**
 * Handles GET /api/slots — lists the authenticated business's slots,
 * optionally filtered by providerId/providerType/serviceId/status/from/to.
 */
export const listSlotsController = asyncHandler(async (req, res) => {
  if (!requireUser(req, res)) return;

  const slots = await listSlots(req.user.businessId, {
    providerId:
      typeof req.query.providerId === 'string'
        ? req.query.providerId
        : undefined,
    providerType: parseProviderType(req.query.providerType),
    serviceId:
      typeof req.query.serviceId === 'string'
        ? req.query.serviceId
        : undefined,
    status: parseStatus(req.query.status),
    from: parseDate(req.query.from),
    to: parseDate(req.query.to),
  });

  return res.status(200).json({ data: slots });
});

/**
 * Handles POST /api/slots/:slotId/block — manually blocks a slot
 * (e.g. a provider calling in sick). Open to any authenticated staff/owner.
 */
export const blockSlotController = asyncHandler<{ slotId: string }>(async (req, res) => {
  if (!requireUser(req, res)) return;

  const result = await blockSlot(req.user.businessId, req.params.slotId);

  if (!result.ok) {
    if (result.error === 'SLOT_NOT_FOUND') {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Slot not found' },
      });
    }

    return res.status(409).json({
      error: {
        code: 'SLOT_NOT_AVAILABLE',
        message: 'This slot is not currently available to block.',
      },
    });
  }

  return res.status(200).json({ data: result.slot });
});
