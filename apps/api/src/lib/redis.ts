import { Redis } from 'ioredis';
import { env } from './env.js';
import {logger} from './logger.js'

/**
 * App-wide Redis client (sessions, holds, rate limiters). TLS is driven
 * by the URL scheme (`rediss://` for Upstash / managed Redis).
 *
 * `maxRetriesPerRequest: 3` (down from ioredis's default 20) so that
 * when Redis is genuinely unreachable a command rejects within seconds
 * rather than tens of seconds — this is what makes login's "fail closed"
 * (architecture doc §9) a fast 500 instead of a hung request. The BullMQ
 * connection in `lib/queue.ts` keeps its own `null` setting, as BullMQ
 * requires.
 */
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  connectTimeout: 10_000,
  enableReadyCheck: true,
});

redis.on('error', (error: Error) => {
  logger.error(error,'Redis connection error:');
});

redis.on('end', () => {
  logger.warn('Redis connection closed');
});

redis.on('reconnecting', () => {
  logger.warn('Redis reconnecting');
});

export async function checkRedisConnection(): Promise<void> {
  await redis.ping();
}
