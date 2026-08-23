import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Pretty logs in local dev only; production Docker uses JSON stdout (no pino-pretty). */
export function getPinoTransport():
  | { target: string; options: Record<string, unknown> }
  | undefined {
  if (process.env.NODE_ENV !== 'development') {
    return undefined;
  }

  try {
    require.resolve('pino-pretty');
  } catch {
    return undefined;
  }

  return {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:standard' },
  };
}
