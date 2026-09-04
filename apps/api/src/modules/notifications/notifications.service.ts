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
 * This intentionally does not send real email yet.
 * Replace this implementation with the real provider adapter
 * once email infrastructure is available.
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

const emailSender: EmailSender = new DevelopmentEmailSender();

export async function sendEmail(input: SendEmailInput): Promise<void> {
  await emailSender.sendEmail(input);
}