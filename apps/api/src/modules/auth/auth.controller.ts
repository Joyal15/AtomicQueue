import type { RequestHandler } from 'express';

export const getAuthStatus: RequestHandler = (_req, res) => {
  res.json({
    module: 'auth',
    status: 'skeleton',
  });
};