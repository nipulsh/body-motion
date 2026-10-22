import { createApp } from './app';
import { env } from './config/env';
import { connectPrisma, disconnectPrisma } from './repositories/prisma';
import { ensureStorageBuckets } from './services/storage/storage.service';
import { logger } from './utils/logger';

async function main(): Promise<void> {
  await connectPrisma();
  await ensureStorageBuckets();

  const app = createApp();
  const server = app.listen(env.PORT, '0.0.0.0', () => {
    logger.info('Body Motion server listening', { port: env.PORT, nodeEnv: env.NODE_ENV });
  });

  async function shutdown(signal: string): Promise<void> {
    logger.info('Shutting down', { signal });
    server.close(async () => {
      await disconnectPrisma();
      process.exit(0);
    });
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

void main().catch(async (error: unknown) => {
  logger.error('Failed to start server', {
    error: error instanceof Error ? error.message : String(error),
  });
  await disconnectPrisma();
  process.exit(1);
});
