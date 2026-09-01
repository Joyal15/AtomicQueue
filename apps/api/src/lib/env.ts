import "dotenv/config";
import { z } from "zod";


const envSchema = z.object({
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.string().min(1, 'FRONTEND_URL is required'),
  // Staff/owner auth is server-side Redis sessions behind an HttpOnly cookie, not JWT
  // (architecture doc Section 9) — this secret signs/verifies the session cookie itself,
  // it is never embedded in a token payload.
  SESSION_COOKIE_SECRET: z.string().min(1, 'SESSION_COOKIE_SECRET is required'),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(604800), // 7-day sliding TTL
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("Invalid environment variables:");
  console.error(z.treeifyError(result.error));
  process.exit(1);
}

export const env = result.data;