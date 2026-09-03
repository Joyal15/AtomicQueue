import type { Request, Response } from 'express';

import type { AuthenticatedUser } from '@queueless/shared-types';

/**
 * Shared per-handler owner/staff role guard, sibling to `requireUser`.
 *
 * Takes the ALREADY-narrowed request type (`req.user` non-optional) —
 * call this only after `requireUser(req, res)` has returned `true`.
 * Requiring that shape makes calling `requireRole` before `requireUser`
 * a compile error instead of a runtime crash, which is exactly the call
 * order every controller needs.
 *
 * There is no general RBAC middleware yet (architecture doc Section 9's
 * role-check layer), so this stays an in-controller guard for now — the
 * same stopgap-until-a-real-thing-exists shape as `requireUser` itself.
 * Extracted because `staffInvitations.controller.ts` needs an owner-only
 * check at three separate call sites, which already clears the bar
 * `requireUser`'s own docstring uses ("written once instead of
 * copy-pasted into every controller").
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
