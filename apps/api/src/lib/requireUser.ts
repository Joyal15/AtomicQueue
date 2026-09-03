import type { Request, Response } from 'express';

import type { AuthenticatedUser } from '@queueless/shared-types';

/**
 * Shared per-handler guard for every controller that reads
 * `req.user` (businessId-scoped routes across `services`,
 * `resources`, `availability`, `providers`, and any future module).
 *
 * `Express.Request.user` is typed optional (`src/types/express.d.ts`)
 * — not every route requires a session — so TypeScript correctly
 * refuses `req.user.businessId` without a narrowing check first
 * (`strict`/`strictNullChecks` is on, `apps/api/tsconfig.json`).
 * This is that check, written once instead of copy-pasted into every
 * controller: a type guard that narrows `req.user` for the rest of
 * the calling function on `true`, and writes the standard 401
 * envelope (architecture doc Section 13) on `false`.
 *
 * Until the `authenticate` session middleware (auth module) is
 * mounted on a router, this is also the ONLY runtime check keeping
 * an unauthenticated request from crashing the handler — not just a
 * type-level formality. Once `authenticate` is attached, this stays
 * as cheap, correct defense-in-depth.
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
