/**
 * HTTP controllers for the Providers module.
 *
 * Thin: pull the tenant identity from the authenticated session
 * (never the body/query), delegate to the service layer, and return
 * the locked `{ data }` envelope (architecture doc Section 13). No
 * validation or persistence logic lives here.
 */

import type { Request, Response } from 'express';

import type { ProviderType } from '@queueless/shared-types';

import { requireUser } from '../../lib/requireUser.js';

import { listProviders } from './providers.service.js';

const PROVIDER_TYPES: readonly ProviderType[] = ['staff', 'resource'];

/**
 * GET /api/providers
 *
 * Lists the authenticated business's providers — staff and
 * resources — in the unified `Provider` shape. Optional query
 * params:
 *   - `type=staff|resource`   restrict to one kind (an unrecognised
 *                             value is ignored, matching the query
 *                             handling in the availability module)
 *   - `includeRemoved=true`   also return retired/removed providers,
 *                             for a management view; omitted by
 *                             default so a picker sees only bookable
 *                             providers
 */
export async function listProvidersController(
  req: Request,
  res: Response,
) {
  if (!requireUser(req, res)) return;

  const typeParam = req.query.type;
  const providerType =
    typeof typeParam === 'string' &&
    PROVIDER_TYPES.includes(typeParam as ProviderType)
      ? (typeParam as ProviderType)
      : undefined;

  const providers = await listProviders(req.user.businessId, {
    providerType,
    includeRemoved: req.query.includeRemoved === 'true',
  });

  return res.status(200).json({
    data: providers,
  });
}
