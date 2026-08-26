import "dotenv/config";
import { z } from "zod";


const envSchema = z.object({
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.string().min(1, 'FRONTEND_URL is required'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  JWT_EXPIRES_IN: z.string().default('7d'),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("Invalid environment variables:");
  console.error(z.treeifyError(result.error));
  process.exit(1);
}

export const env = result.data;