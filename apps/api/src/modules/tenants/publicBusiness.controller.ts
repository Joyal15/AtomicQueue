/**
 * Public (unauthenticated) business endpoints:
 *
 *   - GET /api/businesses        — directory listing for the `/businesses`
 *                                  customer discovery page
 *   - GET /api/businesses/:slug  — single business, the one piece of
 *                                  identity a customer-facing page has
 *                                  from the URL; every other public
 *                                  endpoint (`publicAvailability`,
 *                                  `publicCatalog`, `waitlist` join)
 *                                  needs it resolved to a businessId.
 *
 * Both return an explicit projection — id, name, slug (+ serviceCount on
 * the list) — never a raw document, never `ownerId` or any auth field.
 */

import { asyncHandler } from '../../lib/asyncHandler.js';
import { getActiveServiceCountByBusiness } from '../services/index.js';

import { getBusinessBySlug, listBusinesses } from './tenants.service.js';

export const getPublicBusiness = asyncHandler<{ slug: string }>(async (req, res) => {
  const business = await getBusinessBySlug(req.params.slug);

  if (!business) {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Business not found' },
    });
    return;
  }

  res.status(200).json({
    data: {
      id: business.id,
      name: business.name,
      slug: business.slug,
    },
  });
});

/**
 * GET /api/businesses — public customer directory. Lists businesses that
 * have at least one active service (nothing to book otherwise), each as
 * `{ id, name, slug, serviceCount }`. Optional `?q=` is a case-
 * insensitive substring match on the business name.
 */
export const getPublicBusinesses = asyncHandler(async (req, res) => {
  const q =
    typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : undefined;

  const [businesses, activeServiceCounts] = await Promise.all([
    listBusinesses(q),
    getActiveServiceCountByBusiness(),
  ]);

  const data = businesses
    .map((business) => ({
      id: business.id,
      name: business.name,
      slug: business.slug,
      serviceCount: activeServiceCounts.get(business.id) ?? 0,
    }))
    .filter((business) => business.serviceCount > 0);

  res.status(200).json({ data });
});
