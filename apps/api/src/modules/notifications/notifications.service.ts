import { Resend } from 'resend';

import { env } from '../../lib/env.js';
import { logger } from '../../lib/logger.js';
import { jobsQueue } from '../../lib/queue.js';

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailSender {
  sendEmail(input: SendEmailInput): Promise<void>;
}

/**
 * Development email sender.
 *
 * Used whenever `RESEND_API_KEY`/`RESEND_FROM_EMAIL` aren't set (local
 * dev without a real provider configured) — logs instead of sending,
 * so the rest of the app behaves identically either way.
 */
class DevelopmentEmailSender implements EmailSender {
  async sendEmail(input: SendEmailInput): Promise<void> {
    console.log('[EMAIL]', {
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
  }
}

/**
 * Real provider adapter. `sendEmail`/`enqueueTransactionalEmail`/
 * `enqueueReminderEmail` below don't know or care which `EmailSender`
 * is actually wired up — same separation the dev stub already had.
 */
class ResendEmailSender implements EmailSender {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async sendEmail(input: SendEmailInput): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });

    if (error) {
      // Thrown, not swallowed: this runs inside a BullMQ job handler
      // (worker.ts), so throwing here surfaces as a failed job with
      // BullMQ's own retry/logging — the same place every other job
      // failure in this app is already visible.
      throw new Error(`Resend send failed: ${error.message}`);
    }
  }
}

function createEmailSender(): EmailSender {
  if (env.RESEND_API_KEY && env.RESEND_FROM_EMAIL) {
    return new ResendEmailSender(env.RESEND_API_KEY, env.RESEND_FROM_EMAIL);
  }

  logger.warn(
    'RESEND_API_KEY/RESEND_FROM_EMAIL not set — emails will only be logged, not sent',
  );
  return new DevelopmentEmailSender();
}

const emailSender: EmailSender = createEmailSender();

export async function sendEmail(input: SendEmailInput): Promise<void> {
  await emailSender.sendEmail(input);
}

/**
 * Job names for the shared `queueless-jobs` queue this module enqueues
 * onto. Kept as local literals (not a shared constants file) to match
 * how `worker.ts`/`waitlist.service.ts` already agree on
 * 'waitlist-expire-check' — a duplicated literal string, not a shared
 * import. `worker.ts`'s handler switch must use these exact strings.
 */
const SEND_TRANSACTIONAL_EMAIL_JOB = 'send-transactional-email';
const SEND_REMINDER_EMAIL_JOB = 'send-reminder-email';

/**
 * Enqueues a transactional email (booking confirmation/cancellation/
 * reschedule) to be sent by the worker process instead of inline on
 * the request path that triggered it. The caller renders the final
 * subject/text/html itself — this module stays generic and never
 * needs to know what a "booking" is (same separation `sendEmail`
 * already has today).
 *
 * `removeOnComplete`/`removeOnFail` are both set explicitly: this job
 * can carry a magic-link access token in `text`/`html`, so its outcome
 * must never be silently discarded on either path (PROJECT_PLAN
 * Phase 4's explicit instruction for this job).
 */
export async function enqueueTransactionalEmail(
  input: SendEmailInput,
): Promise<void> {
  await jobsQueue.add(SEND_TRANSACTIONAL_EMAIL_JOB, input, {
    removeOnComplete: true,
    removeOnFail: true,
  });
}

/**
 * Schedules a reminder email for a future delivery time (e.g. "24
 * hours before the appointment"). The caller computes `sendAt` from
 * whatever booking/appointment data it has — this module only turns a
 * target time into a BullMQ delay. A `sendAt` already in the past
 * enqueues the job to run immediately (a negative delay clamps to 0).
 */
export async function enqueueReminderEmail(
  input: SendEmailInput,
  sendAt: Date,
): Promise<void> {
  const delay = Math.max(0, sendAt.getTime() - Date.now());

  await jobsQueue.add(SEND_REMINDER_EMAIL_JOB, input, { delay });
}
