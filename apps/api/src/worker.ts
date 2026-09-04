import { Worker } from 'bullmq';

import { connectDatabase } from './lib/db.js';
import { logger } from './lib/logger.js';
import { JOBS_QUEUE_NAME, jobsQueue, queueConnection } from './lib/queue.js';
import { listBusinessIds } from './modules/tenants/index.js';
import { generateWeeklySlots } from './modules/slots/index.js';

/**
 * Standalone worker process — separate from the API server (`server.ts`)
 * so a slow/failing job never blocks request handling. Run with
 * `npm run worker` alongside `npm run dev`.
 */

const GENERATE_WEEKLY_SLOTS_JOB = 'generate-weekly-slots';

/**
 * Tops up every business's rolling slot-generation window (architecture
 * doc §6). Thin wrapper — all the actual logic already lives in
 * `generateWeeklySlots` (Phase 3); this just iterates every business.
 *
 * Safe if one business fails: `generateWeeklySlots` is idempotent per
 * business, so a thrown error here (surfaced to BullMQ's own retry)
 * only delays that one business's generation, never corrupts another
 * business's slots or double-generates anything on retry.
 */
async function runGenerateWeeklySlots(): Promise<void> {
  const businessIds = await listBusinessIds();

  for (const businessId of businessIds) {
    const result = await generateWeeklySlots(businessId);
    logger.info(
      { businessId, ...result },
      'generate-weekly-slots ran for business',
    );
  }
}

/**
 * No other jobs are registered yet — this is the extension point future
 * jobs (`send-transactional-email`, `process-hold-expiry`, etc.) add a
 * case to as they're built.
 */
async function processJob(jobName: string): Promise<void> {
  switch (jobName) {
    case GENERATE_WEEKLY_SLOTS_JOB:
      await runGenerateWeeklySlots();
      break;
    default:
      logger.warn(`No handler registered for job "${jobName}"`);
  }
}

async function startWorker() {
  await connectDatabase();

  const worker = new Worker(
    JOBS_QUEUE_NAME,
    async (job) => {
      await processJob(job.name);
    },
    { connection: queueConnection },
  );

  worker.on('ready', () => {
    logger.info(`Worker listening on queue "${JOBS_QUEUE_NAME}"`);
  });

  worker.on('failed', (job, error) => {
    logger.error(error, `Job "${job?.name}" failed`);
  });

  // Registers the recurring schedule — idempotent (upsert), so safe to
  // call on every worker boot rather than needing a separate one-time
  // setup step. Runs once a day to keep generateWeeklySlots's own
  // rolling 7-day window from ever going stale.
  await jobsQueue.upsertJobScheduler(
    GENERATE_WEEKLY_SLOTS_JOB,
    { pattern: '0 0 * * *' },
    { name: GENERATE_WEEKLY_SLOTS_JOB },
  );

  async function shutdown() {
    logger.info('Worker shutting down');
    await worker.close();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startWorker();
