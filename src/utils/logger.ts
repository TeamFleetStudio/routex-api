import pino from 'pino';
import { getPinoTransport } from './pino-transport.js';

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
  transport: getPinoTransport(),
});

export type Logger = typeof logger;
