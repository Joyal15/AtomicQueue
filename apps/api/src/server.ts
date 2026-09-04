import { createServer } from 'node:http';
import express from 'express';
import { env } from './lib/env.js';
import { connectDatabase, isDatabaseConnected} from './lib/db.js';
import { errorHandler } from './middleware/errorHandler.js';
import {pinoHttp} from 'pino-http';
import { logger } from './lib/logger.js';
import { redis, checkRedisConnection } from './lib/redis.js';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import routes from './routes.js';
import cookieParser from 'cookie-parser';
import { initRealtime } from './modules/realtime/index.js';

const app = express();
const httpServer = createServer(app);
const port = Number(env.PORT || 4000);

// Trusts the first hop's X-Forwarded-For (a single reverse proxy/load
// balancer in front of this process, e.g. Render/Railway/nginx). Without
// this, req.ip resolves to the proxy's own address for every request,
// which silently breaks every per-IP rate limiter (magic-link resend,
// login) since every caller looks like the same IP.
app.set('trust proxy', 1);

app.use(helmet());
app.use(pinoHttp({logger}));
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  }),
);
app.use('/api', routes);

app.get('/health', (_req, res) => {
  const databaseConnected = isDatabaseConnected();

  res.status(databaseConnected ? 200 : 503).json({
    status: databaseConnected ? 'ok' : 'degraded',
    database: databaseConnected ? 'connected' : 'disconnected',
  });
});

// Catch-all for unmatched routes, so a 404 comes back in the same
// `{ error }` shape as every other response instead of Express's
// default HTML page.
app.use((_req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Route not found.' },
  });
});

app.use(errorHandler)

// Last-resort safety net: log a truly unexpected crash before the
// process dies instead of letting it disappear silently.
process.on('uncaughtException', (error) => {
  logger.error(error, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error(reason, 'Unhandled promise rejection');
  process.exit(1);
});

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);

  httpServer.close(async (closeError) => {
    if (closeError) {
      logger.error(closeError, 'Error while closing HTTP server');
    }

    try {
      await mongoose.connection.close();
      redis.disconnect();
    } finally {
      process.exit(closeError ? 1 : 0);
    }
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

async function startServer() {
  await connectDatabase();
  await checkRedisConnection();

  initRealtime(httpServer);

  httpServer.listen(port, () => {
    logger.info(`API listening on http://localhost:${port}`);
  });
}


startServer();


