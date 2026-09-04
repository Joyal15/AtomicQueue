/**
 * HTTP controller for the public (unauthenticated) availability view.
 *
 * Resolves a business by its public slug and returns its bookable
 * time slots aggregated into (providerId, datetime) buckets, showing
 * remaining capacity rather than individual anonymous slot documents
 * (architecture doc §4b, §13a). No session required — this is what
 * an anonymous customer's booking page calls.
 */

import type { ProviderType } from '@queueless/shared-types';

import { asyncHandler } from '../../lib/asyncHandler.js';
import { getBusinessBySlug } from '../tenants/index.js';
import { getPublicAvailabilityBuckets } from '../slots/index.js';

function parseProviderType(value: unknown): ProviderType | undefined {
  return value === 'staff' || value === 'resource' ? value : undefined;
}

/**
 * Handles GET /api/businesses/:slug/availability. Optional
 * serviceId/providerId/providerType query filters narrow the browse
 * view, e.g. once a customer has picked a service.
 */
export const getPublicAvailability = asyncHandler<{ slug: string }>(async (req, res) => {
  const business = await getBusinessBySlug(req.params.slug);

  if (!business) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Business not found' },
    });
  }

  const buckets = await getPublicAvailabilityBuckets(business.id, {
    serviceId:
      typeof req.query.serviceId === 'string'
        ? req.query.serviceId
        : undefined,
    providerId:
      typeof req.query.providerId === 'string'
        ? req.query.providerId
        : undefined,
    providerType: parseProviderType(req.query.providerType),
  });

  return res.status(200).json({ data: buckets });
});
