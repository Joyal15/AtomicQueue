import type { RequestHandler } from 'express';

export const getAuthStatus: RequestHandler = (_req, res) => {
  res.json({
    status: 'ok',
    data: { module: 'auth', status: 'skeleton' },
  });
};