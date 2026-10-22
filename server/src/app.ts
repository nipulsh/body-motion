import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { globalRateLimiter } from './middleware/rateLimit.middleware';
import apiRoutes from './routes';
import { logger } from './utils/logger';

export function createApp(): express.Application {
  const app = express();

  if (env.TRUST_PROXY) {
    app.set('trust proxy', 1);
  }

  app.use(helmet());
  app.use(
    cors({
      origin:
        env.corsOrigins === '*'
          ? true
          : env.corsOrigins.length > 0
            ? env.corsOrigins
            : false,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(globalRateLimiter);

  app.use((req, _res, next) => {
    req.requestId = randomUUID();
    logger.info('[API]', {
      method: req.method,
      path: req.originalUrl.split('?')[0],
      requestId: req.requestId,
    });
    next();
  });

  app.use('/api', apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
