import type { ErrorRequestHandler } from 'express';
import { logger } from '../lib/logger.js';
import { AppError } from '../lib/Apperror.js';

export const errorHandler: ErrorRequestHandler = (
  err,
  _req,
  res,
  _next
) => {
  logger.error(err, "Unhandled application error");

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
      },
    });
    return;
  }

  // Generic 500 response only; the real error is logged above, never sent to the client.
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
    },
  });
};