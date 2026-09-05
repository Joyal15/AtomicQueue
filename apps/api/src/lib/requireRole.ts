import type { Request, Response } from 'express';

import type { AuthenticatedUser } from '@queueless/shared-types';

/**
 * Checks that req.user has the given role, writing a 403 response if not.
 * Call only after `requireUser(req, res)` has returned true, since it
 * requires `req.user` to already be narrowed to non-optional.
 */
export function requireRole(
  req: Request & { user: AuthenticatedUser },
  res: Response,
  role: AuthenticatedUser['role'],
): boolean {
  if (req.user.role !== role) {
    res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action.',
      },
    });

    return false;
  }

  return true;
}

export function requireAnyRole(
  ...roles: AuthenticatedUser['role'][]
) {
  return (
    req: Request,
    res: Response,
    next: () => void,
  ): void => {
    if (!req.user) {
      res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication required.',
        },
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have permission to perform this action.',
        },
      });
      return;
    }

    next();
  };
}
