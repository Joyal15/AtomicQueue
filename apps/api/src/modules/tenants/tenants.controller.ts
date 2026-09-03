import type { RequestHandler } from 'express';

export const getTenantsStatus: RequestHandler = (req, res) => {
  res.json({
    data: {
      module: 'tenants',
      status: 'skeleton',
    },
  });
};