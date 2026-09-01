import type { ErrorRequestHandler } from 'express';
import { logger } from '../lib/logger.js';

export const errorHandler: ErrorRequestHandler = (
  err,
  _req,
  res,
  _next
) => {
  logger.error(err, "Unhandled application error");

  // Locked contract (architecture doc Section 13 / Decision #18): a 500 body is always
  // this fixed generic shape — the real error goes to the log line above only, never
  // the response. Never send err.message, a stack trace, or any driver-level detail here.
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
    },
  });
};