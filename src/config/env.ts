import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  DEFAULT_SOURCE_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  DEFAULT_SOURCE_RETRY_COUNT: z.coerce.number().int().min(0).default(2),
  CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
  CIRCUIT_COOLDOWN_MS: z.coerce.number().int().positive().default(30_000),
  LOCK_TTL_MS: z.coerce.number().int().positive().default(15_000),
  LOCK_WAIT_MS: z.coerce.number().int().positive().default(2_000),
  LOCK_POLL_MS: z.coerce.number().int().positive().default(100),
  STALE_MULTIPLIER: z.coerce.number().positive().default(3),
  REDBUS_API_URL: z.string().optional().default(''),
  REDBUS_API_KEY: z.string().optional().default(''),
  ABHIBUS_API_URL: z.string().optional().default(''),
  ABHIBUS_API_KEY: z.string().optional().default(''),
  MMT_API_URL: z.string().optional().default(''),
  MMT_API_KEY: z.string().optional().default(''),
  SELF_HEALING_API_URL: z.string().optional().default(''),
  SELF_HEALING_API_KEY: z.string().optional().default(''),
  BRIGHT_DATA_API_TOKEN: z.string().optional().default(''),
  BRIGHT_DATA_BASE_URL: z.string().default('https://api.brightdata.com'),
  REDBUS_COLLECTOR_ID: z.string().default('c_mt2zg2lg2mzr0gwzzr'),
  ABHIBUS_COLLECTOR_ID: z.string().default('c_mt3098pc2d2if01a7g'),
  BRIGHT_DATA_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  BRIGHT_DATA_MAX_POLL_ATTEMPTS: z.coerce.number().int().positive().default(60),
  BRIGHT_DATA_SOURCE_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  ABHIBUS_RESULT_LIMIT: z.coerce.number().int().positive().default(10),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function loadEnv(overrides?: Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}

export function getEnv(): Env {
  if (!cachedEnv) {
    return loadEnv();
  }
  return cachedEnv;
}

export function resetEnvCache(): void {
  cachedEnv = null;
}
