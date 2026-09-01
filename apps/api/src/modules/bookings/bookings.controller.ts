import type { RequestHandler } from 'express';

export const getBookingsStatus: RequestHandler = (_req, res) => {
  res.json({
    data: { module: 'bookings', status: 'skeleton' },
  });
};