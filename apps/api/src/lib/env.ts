import "dotenv/config";
import { z } from "zod";


const envSchema = z.object({
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.string().min(1, 'FRONTEND_URL is required'),
  // Signs/verifies the session cookie (sessions are stored in Redis, not JWT).
  SESSION_COOKIE_SECRET: z.string().min(1, 'SESSION_COOKIE_SECRET is required'),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(604800), // 7-day sliding TTL
  MAGIC_LINK_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  // Optional: unset in local dev falls back to a console-log stub
  // sender (see notifications.service.ts) instead of failing startup.
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.email().optional(),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("Invalid environment variables:");
  console.error(z.treeifyError(result.error));
  process.exit(1);
}

export const env = result.data;