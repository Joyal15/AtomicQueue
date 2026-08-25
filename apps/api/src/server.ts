import express from 'express';
import { validate } from './middleware/validate.js';
import { env } from './lib/env.js';
import { connectDatabase, isDatabaseConnected} from './lib/db.js';
import { errorHandler } from './middleware/errorHandler.js';
import {pinoHttp} from 'pino-http';
import { logger } from './lib/logger.js';
import { authRouter } from './modules/auth/index.js';
import { tenantsRouter } from './modules/tenants/index.js';
import { bookingsRouter } from './modules/bookings/index.js';
import { checkRedisConnection } from './lib/redis.js';

const app = express();
const port = Number(env.PORT || 4000);

app.use(pinoHttp({logger}));
app.use(express.json());
app.use('/auth', authRouter);
app.use('/tenants', tenantsRouter);
app.use('/bookings', bookingsRouter);

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

//test2
// const testSchema = z.object({
//   name: z.string().min(1),
// });
// app.post('/test-validation', validate(testSchema), (req, res) => {
//   res.json({
//     status: 'ok',
//     data: req.body,
//   });
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


