import type { RequestHandler } from 'express';

export const getAuthStatus: RequestHandler = (_req, res) => {
  res.json({
    data: { module: 'auth', status: 'skeleton' },
  });
};