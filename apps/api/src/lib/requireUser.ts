import type { Request, Response } from 'express';

import type { AuthenticatedUser } from '@queueless/shared-types';

/**
 * Type guard that checks `req.user` is set, writing a 401 response and
 * returning false if not. On true, narrows `req.user` to non-optional
 * for the rest of the calling function.
 */
export function requireUser(
  req: Request,
  res: Response,
): req is Request & { user: AuthenticatedUser } {
  if (!req.user) {
    res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required.',
      },
    });

    return false;
  }

  return true;
}
