/**
 * HTTP controllers for the Providers module.
 *
 * Pull the tenant identity from the session (never the body/query),
 * delegate to the service layer, and return `{ data }`.
 */

import type { ProviderType } from '@queueless/shared-types';

import { asyncHandler } from '../../lib/asyncHandler.js';
import { requireUser } from '../../lib/requireUser.js';

import { listProviders } from './providers.service.js';

const PROVIDER_TYPES: readonly ProviderType[] = ['staff', 'resource'];

/**
 * GET /api/providers
 *
 * Lists the authenticated business's providers — staff and resources —
 * in the unified `Provider` shape. Optional query params:
 *   - `type=staff|resource`   restrict to one kind (unrecognised value
 *                             is ignored)
 *   - `includeRemoved=true`   also include retired/removed providers;
 *                             defaults to bookable-only
 */
export const listProvidersController = asyncHandler(async (req, res) => {
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
});
