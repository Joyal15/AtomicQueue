import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { env } from './env.js';

/**
 * Dedicated Redis connection for BullMQ. Kept separate from the shared
 * `redis` client in `lib/redis.ts` (sessions, slot holds) because BullMQ
 * requires `maxRetriesPerRequest: null` on its connection, and forcing
 * that setting onto the shared client would change retry behavior for
 * everything else using it. Same target Redis instance either way —
 * just its own client.
 */
export const queueConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

/**
 * Single shared queue name for now. Job-specific queues (e.g. splitting
 * emails from slot generation) can be added later if volume or retry
 * policy ever needs to differ per job type — not needed yet.
 */
export const JOBS_QUEUE_NAME = 'queueless-jobs';

/**
 * Producer handle — import this from any module that needs to enqueue
 * a job (e.g. a scheduled `generate-weekly-slots` run). The worker
 * process (`worker.ts`) is what actually consumes from this queue.
 */
export const jobsQueue = new Queue(JOBS_QUEUE_NAME, {
  connection: queueConnection,
});
