import { loadEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const { app, redis } = await buildApp(env);

  const shutdown = async (signal: string) => {
    logger.info({ event: 'SHUTDOWN', signal }, 'Shutting down');
    try {
      await app.close();
      redis.disconnect();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ event: 'SERVER_STARTED', port: env.PORT }, 'RouteX API listening');
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start RouteX API');
  process.exit(1);
});
