import type { RequestHandler } from 'express';
import { UserModel } from './auth.model.js';
import { getSession, refreshSession } from './auth.session.js';

const SESSION_COOKIE_NAME = 'session';

export const authenticate: RequestHandler = async (req, res, next) => {
  try {
    const sessionId = req.cookies?.[SESSION_COOKIE_NAME];

    if (!sessionId) {
      res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication required.',
        },
      });
      return;
    }

    const session = await getSession(sessionId);

    if (!session) {
      res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication required.',
        },
      });
      return;
    }

    const user = await UserModel.findById(session.userId)
      .select(
        'role businessId status passwordChangedAt sessionsInvalidatedAt',
      )
      .lean();

    if (!user || user.status !== 'active') {
      res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication required.',
        },
      });
      return;
    }

    const passwordChangedAt = user.passwordChangedAt.getTime();
    const sessionsInvalidatedAt =
      user.sessionsInvalidatedAt?.getTime() ?? null;

    if (
      session.issuedAt < passwordChangedAt ||
      (sessionsInvalidatedAt !== null &&
        session.issuedAt < sessionsInvalidatedAt)
    ) {
      res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication required.',
        },
      });
      return;
    }

    await refreshSession(sessionId);

    req.user = {
      userId: String(user._id),
      role: user.role,
      businessId: user.businessId,
    };

    next();
  } catch (error) {
    next(error);
  }
};