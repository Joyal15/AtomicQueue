import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import type { ParsedQs } from 'qs';

/**
 * Wraps an async Express route handler so a rejected promise reaches
 * `next(error)` automatically. Express 4 does not do this on its own —
 * without this wrapper, a thrown error or rejected promise inside an
 * async handler is an unhandled rejection: no response is ever sent and
 * the request just hangs until the client/proxy times out, instead of
 * reaching `errorHandler`.
 *
 * Generic defaults mirror Express's own `RequestHandler` defaults so
 * `req`/`res` stay assignable to plain `Request`/`Response` (e.g. for
 * `requireUser`/`requireRole`) when no generics are supplied.
 */
export function asyncHandler<
  P = ParamsDictionary,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ResBody = any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ReqBody = any,
  ReqQuery = ParsedQs,
>(
  fn: (
    req: Request<P, ResBody, ReqBody, ReqQuery>,
    res: Response<ResBody>,
    next: NextFunction,
  ) => Promise<unknown>,
): RequestHandler<P, ResBody, ReqBody, ReqQuery> {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
