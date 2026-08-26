import type { RequestHandler } from 'express';

export const getTenantsStatus: RequestHandler = (_req, res) => {
  res.json({
    status: 'ok',
    data: { module: 'tenants', status: 'skeleton' },
  });
};