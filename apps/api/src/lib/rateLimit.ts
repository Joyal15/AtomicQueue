import type { Request, RequestHandler } from 'express';

import { redis } from './redis.js';
import { logger } from './logger.js';

/**
 * Atomically INCR a key and, only on the increment that creates it, set
 * its TTL — one round trip, no check-then-set race window (architecture
 * doc §9's "one atomic Redis operation … never check-then-increment"
 * rule, applied to every Redis-backed limiter in this codebase, not just
 * login). Returns the post-increment count.
 */
const INCR_WITH_TTL_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
`;

export async function incrementWithTtl(
  key: string,
  windowSeconds: number,
): Promise<number> {
  const result = await redis.eval(
    INCR_WITH_TTL_LUA,
    1,
    key,
    String(windowSeconds),
  );

  return Number(result);
}

/**
 * Reads a counter without touching it — used for a pre-flight lockout
 * check that must not itself count as an attempt.
 */
export async function peekCount(key: string): Promise<number> {
  const value = await redis.get(key);
  return value ? Number(value) : 0;
}

export interface RateLimitOptions {
  /** Redis key namespace, e.g. `'rl:bookings:hold'`. */
  keyPrefix: string;
  /** Max requests allowed per window. */
  limit: number;
  /** Window length in seconds — also the `Retry-After` value on a 429. */
  windowSeconds: number;
  /**
   * Per-caller key suffix. Defaults to the client IP (`req.ip`, which is
   * correct because `server.ts` sets `trust proxy`). Return `null` to
   * skip limiting for this request.
   */
  key?: (req: Request) => string | null;
  /**
   * Behaviour when Redis is unreachable:
   *  - `'closed'` → respond `500` (login-grade protection; a limiter
   *    that silently stops limiting is worse than a brief outage).
   *  - `'open'` → let the request through (public browsing / booking:
   *    a hard Redis dependency for anonymous traffic would cause more
   *    harm than the abuse it prevents). Default.
   */
  onRedisError?: 'open' | 'closed';
}

/**
 * Fixed-window per-key rate limiter middleware. Emits the §13 contract on
 * a limit hit: `429` + `Retry-After`, generic body, identical regardless
 * of anything about the caller.
 */
export function rateLimit(options: RateLimitOptions): RequestHandler {
  const failMode = options.onRedisError ?? 'open';

  return (req, res, next) => {
    const suffix = options.key ? options.key(req) : (req.ip ?? 'unknown');

    if (suffix === null) {
      next();
      return;
    }

    const redisKey = `${options.keyPrefix}:${suffix}`;

    incrementWithTtl(redisKey, options.windowSeconds)
      .then((count) => {
        if (count > options.limit) {
          res.setHeader('Retry-After', String(options.windowSeconds));
          res.status(429).json({
            error: {
              code: 'RATE_LIMITED',
              message:
                'Too many requests. Please slow down and try again shortly.',
            },
          });
          return;
        }
        next();
      })
      .catch((error: unknown) => {
        if (failMode === 'closed') {
          logger.error(
            { err: error, key: redisKey },
            'rate limiter: Redis unreachable — failing closed (500)',
          );
          res.status(500).json({
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Something went wrong. Please try again.',
            },
          });
          return;
        }
        logger.warn(
          { err: error, key: redisKey },
          'rate limiter: Redis unreachable — allowing request (fail-open)',
        );
        next();
      });
  };
}
