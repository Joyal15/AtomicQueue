import { randomBytes } from 'node:crypto';

import { redis } from '../../lib/redis.js';

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const SESSION_KEY_PREFIX = 'session:';

export interface RedisSession {
  userId: string;
  issuedAt: number;
}

function getSessionKey(sessionId: string): string {
  return `${SESSION_KEY_PREFIX}${sessionId}`;
}

/**
 * Create a fresh authenticated session.
 *
 * The session ID is deliberately opaque and cryptographically random.
 * We never reuse a session ID supplied by the client.
 */
export async function createSession(userId: string): Promise<{
  sessionId: string;
  issuedAt: number;
}> {
  const sessionId = randomBytes(32).toString('hex');
  const issuedAt = Date.now();

  const session: RedisSession = {
    userId,
    issuedAt,
  };

  await redis.set(
    getSessionKey(sessionId),
    JSON.stringify(session),
    'EX',
    SESSION_TTL_SECONDS,
  );

  return {
    sessionId,
    issuedAt,
  };
}

/**
 * Retrieve an authenticated session from Redis.
 *
 * Redis is authoritative for session existence.
 */
export async function getSession(
  sessionId: string,
): Promise<RedisSession | null> {
  const value = await redis.get(getSessionKey(sessionId));

  if (!value) {
    return null;
  }

  return JSON.parse(value) as RedisSession;
}

/**
 * Refresh the session's sliding idle timeout.
 *
 * Only authenticated HTTP activity should call this.
 */
export async function refreshSession(
  sessionId: string,
): Promise<boolean> {
  const refreshed = await redis.expire(
    getSessionKey(sessionId),
    SESSION_TTL_SECONDS,
  );

  return refreshed === 1;
}

/**
 * Delete a single session.
 */
export async function deleteSession(sessionId: string): Promise<void> {
  await redis.del(getSessionKey(sessionId));
}