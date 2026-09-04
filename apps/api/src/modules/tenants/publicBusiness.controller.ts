/**
 * Public (unauthenticated) business lookup by slug — the one piece of
 * identity a customer-facing page has (from the URL), and the one
 * thing every other public endpoint (`publicAvailability`,
 * `publicCatalog`, `waitlist` join) needs resolved into a businessId
 * before it can do anything.
 */

import type { NextFunction, Request, Response } from 'express';

import { getBusinessBySlug } from './tenants.service.js';

export async function getPublicBusiness(
  req: Request<{ slug: string }>,
  res: Response,
  next: NextFunction,
) {
  try {
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
  } catch (error) {
    next(error);
  }
}
