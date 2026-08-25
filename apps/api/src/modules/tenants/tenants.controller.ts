import type { RequestHandler } from 'express';

export const getTenantsStatus: RequestHandler = (_req, res) => {
  res.json({
    module: 'tenants',
    status: 'skeleton',
  });
};