import { Worker } from 'bullmq';

import { connectDatabase } from './lib/db.js';
import { logger } from './lib/logger.js';
import { JOBS_QUEUE_NAME, queueConnection } from './lib/queue.js';

/**
 * Standalone worker process — separate from the API server (`server.ts`)
 * so a slow/failing job never blocks request handling. Run with
 * `npm run worker` alongside `npm run dev`.
 *
 * No real jobs are registered yet — this is just the process + queue
 * wiring (BullMQ install, Section 6 of the architecture doc). Each
 * future job (`generate-weekly-slots`, `send-transactional-email`, etc.)
 * adds a case below as it's built.
 */
async function processJob(jobName: string): Promise<void> {
  switch (jobName) {
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

  async function shutdown() {
    logger.info('Worker shutting down');
    await worker.close();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startWorker();
