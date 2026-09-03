import type { AuthenticatedUser } from '@queueless/shared-types';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      sessionId?: string;
    }
  }
}

export {};