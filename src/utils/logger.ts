import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'routex-api' },
  redact: {
    paths: [
      'apiKey',
      'api_key',
      'authorization',
      'headers.authorization',
      'REDIS_URL',
      'req.headers.authorization',
    ],
    remove: true,
  },
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
});

export type Logger = typeof logger;
