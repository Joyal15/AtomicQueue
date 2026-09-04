import type { ErrorRequestHandler } from 'express';
import { Error as MongooseError } from 'mongoose';
import { ZodError } from 'zod';

import { logger } from '../lib/logger.js';
import { AppError } from '../lib/Apperror.js';

export const errorHandler: ErrorRequestHandler = (
  err,
  _req,
  res,
  next
) => {
  // Per Express's own error-handling guide: once headers are already
  // sent (e.g. a response was mid-stream), the only safe move is to
  // delegate to Express's built-in default handler — calling
  // res.status()/res.json() again here would throw its own error.
  if (res.headersSent) {
    return next(err);
  }

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

  // Defensive: `validate()` catches Zod errors from request bodies before
  // a handler ever runs, but a service function can still throw one
  // directly (e.g. parsing a value pulled from the DB). Same shape as
  // `validate()`'s response either way.
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.length > 0 ? issue.path.join('.') : '_root';
      if (!(key in fields)) fields[key] = issue.message;
    }

    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Please check the highlighted fields.',
        fields,
      },
    });
    return;
  }

  // A malformed ObjectId in a route param (e.g. GET /resources/not-an-id)
  // throws this from Mongoose before any query runs — the caller's
  // input problem, not a server failure.
  if (err instanceof MongooseError.CastError) {
    res.status(400).json({
      error: {
        code: 'INVALID_ID',
        message: 'Invalid identifier.',
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
