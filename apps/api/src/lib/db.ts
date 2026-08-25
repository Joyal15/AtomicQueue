import mongoose from "mongoose";
import { env } from "./env.js";
import { logger } from "./logger.js";

export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(env.MONGODB_URI);
    logger.info("MongoDB connected");
  } catch (error) {
    logger.error(error, "MongoDB connection failed");
    process.exit(1);
  }
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}