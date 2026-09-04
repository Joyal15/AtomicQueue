/**
 * HTTP controllers for the public (unauthenticated) service/provider
 * catalog. The public availability endpoint only ever returns opaque
 * serviceId/providerId strings (§4b's bucket shape) — a customer-facing
 * booking page needs somewhere to resolve those into names, and there
 * was nowhere public to do that until now.
 *
 * Both wrap already-existing, already-owned reads (`getServices`,
 * `listProviders`) — no new business logic, just a public projection
 * that drops internal-only fields (`isActive`, `status`, `role`,
 * `businessId`) a customer has no use for.
 */

import type { Response } from 'express';

import { asyncHandler } from '../../lib/asyncHandler.js';
import { getBusinessBySlug } from '../tenants/index.js';
import { getServices } from '../services/index.js';
import { listProviders } from '../providers/index.js';

async function resolveBusinessOr404(
  slug: string,
  res: Response,
): Promise<{ id: string } | null> {
  const business = await getBusinessBySlug(slug);

  if (!business) {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Business not found' },
    });
    return null;
  }

  return business;
}

/** Handles GET /api/businesses/:slug/services — active services only. */
export const getPublicServices = asyncHandler<{ slug: string }>(async (req, res) => {
  const business = await resolveBusinessOr404(req.params.slug, res);
  if (!business) return;

  const services = await getServices(business.id);

  res.status(200).json({
    data: services
      .filter((service) => service.isActive)
      .map((service) => ({
        id: service.id,
        name: service.name,
        durationMinutes: service.durationMinutes,
        price: service.price,
      })),
  });
});

/** Handles GET /api/businesses/:slug/providers — active providers only. */
export const getPublicProviders = asyncHandler<{ slug: string }>(async (req, res) => {
  const business = await resolveBusinessOr404(req.params.slug, res);
  if (!business) return;

  const providers = await listProviders(business.id);

  res.status(200).json({
    data: providers.map((provider) => ({
      providerId: provider.providerId,
      providerType: provider.providerType,
      name: provider.name,
      capacity: provider.capacity,
    })),
  });
});
