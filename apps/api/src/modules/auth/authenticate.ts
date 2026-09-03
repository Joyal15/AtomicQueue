import type { RequestHandler } from 'express';

import type { AuthenticatedUser } from '@queueless/shared-types';

import { UserModel } from './auth.model.js';
import { getSession, refreshSession } from './auth.session.js';

const SESSION_COOKIE_NAME = 'session';

/**
 * Resolves a session cookie value to the authenticated user it belongs
 * to, or null if the session is missing/expired/stale. This is the
 * one place that owns the session -> user validity rules (active
 * status, password-change/logout-everywhere invalidation) — both the
 * HTTP `authenticate` middleware below and the Socket.IO gateway's
 * handshake auth call this instead of re-checking these rules
 * themselves.
 */
export async function resolveAuthenticatedUser(
  sessionId: string | undefined,
): Promise<AuthenticatedUser | null> {
  if (!sessionId) {
    return null;
  }

  const session = await getSession(sessionId);

  if (!session) {
    return null;
  }

  const user = await UserModel.findById(session.userId)
    .select('role businessId status passwordChangedAt sessionsInvalidatedAt')
    .lean();

  if (!user || user.status !== 'active') {
    return null;
  }

  const passwordChangedAt = user.passwordChangedAt.getTime();
  const sessionsInvalidatedAt = user.sessionsInvalidatedAt?.getTime() ?? null;

  // A session issued before the password last changed, or before the
  // last "log out everywhere", is stale even though it hasn't expired.
  if (
    session.issuedAt < passwordChangedAt ||
    (sessionsInvalidatedAt !== null && session.issuedAt < sessionsInvalidatedAt)
  ) {
    return null;
  }

  await refreshSession(sessionId);

  return {
    userId: String(user._id),
    role: user.role,
    businessId: user.businessId,
  };
}

export const authenticate: RequestHandler = async (req, res, next) => {
  try {
    const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
    const user = await resolveAuthenticatedUser(sessionId);

    if (!user) {
      res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication required.',
        },
      });
      return;
    }

    req.user = user;

    next();
  } catch (error) {
    next(error);
  }
};
