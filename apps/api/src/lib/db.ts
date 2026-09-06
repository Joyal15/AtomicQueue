import mongoose from "mongoose";
import { env } from "./env.js";
import { logger } from "./logger.js";

/**
 * Production-oriented connection options (architecture doc §14 deploy
 * hardening). All safe in local dev too:
 *  - bounded pool so a burst can't open unbounded sockets to Atlas
 *  - explicit server-selection / socket timeouts so a network partition
 *    surfaces as a fast error instead of a hung request
 *  - retryWrites/retryReads so a transient primary step-down (routine on
 *    Atlas) is retried transparently rather than thrown
 */
const CONNECTION_OPTIONS: mongoose.ConnectOptions = {
  serverSelectionTimeoutMS: 10_000,
  socketTimeoutMS: 45_000,
  maxPoolSize: 10,
  minPoolSize: 1,
  retryWrites: true,
  retryReads: true,
};

export async function connectDatabase(): Promise<void> {
  mongoose.connection.on("disconnected", () => {
    logger.warn("MongoDB disconnected");
  });
  mongoose.connection.on("reconnected", () => {
    logger.info("MongoDB reconnected");
  });
  mongoose.connection.on("error", (error) => {
    logger.error(error, "MongoDB connection error");
  });

  try {
    await mongoose.connect(env.MONGODB_URI, CONNECTION_OPTIONS);
    logger.info("MongoDB connected");
  } catch (error) {
    logger.error(error, "MongoDB connection failed");
    process.exit(1);
  }
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
