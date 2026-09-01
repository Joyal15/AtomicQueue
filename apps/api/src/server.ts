import express from 'express';
import { env } from './lib/env.js';
import { connectDatabase, isDatabaseConnected} from './lib/db.js';
import { errorHandler } from './middleware/errorHandler.js';
import {pinoHttp} from 'pino-http';
import { logger } from './lib/logger.js';
import { checkRedisConnection } from './lib/redis.js';
import cors from 'cors';
import routes from './routes.js';

const app = express();
const port = Number(env.PORT || 4000);

app.use(pinoHttp({logger}));
app.use(express.json());
app.use(
  cors({
    origin: env.FRONTEND_URL,
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

//test1
// app.get('/test-error', (_req, _res) => {
//   throw new Error('Test error');
// });

app.use(errorHandler)

async function startServer() {
  await connectDatabase();
  await checkRedisConnection();
  

  app.listen(port, () => {
    logger.info(`API listening on http://localhost:${port}`);
  });
}


startServer();


