import { Redis } from 'ioredis';
import { env } from './env.js';
import {logger} from './logger.js'

export const redis = new Redis(env.REDIS_URL);

redis.on('error', (error: Error) => {
  logger.error(error,'Redis connection error:');
});

export async function checkRedisConnection(): Promise<void> {
  await redis.ping();
}