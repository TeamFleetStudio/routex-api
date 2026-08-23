import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { loadBrightDataApiTokenFromCli } from './bright-data-credentials.js';

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
  BRIGHT_DATA_API_TOKEN: z.string().optional().default(''),
  BRIGHTDATA_API_KEY: z.string().optional().default(''),
  BRIGHT_DATA_BASE_URL: z.string().default('https://api.brightdata.com'),
  REDBUS_COLLECTOR_ID: z.string().default('c_mt5kcpdj13nspwzrzd'),
  MAKEMYTRIP_COLLECTOR_ID: z.string().default('c_mt5m1h3uvef2inukz'),
  CLEARTrip_COLLECTOR_ID: z.string().default('c_mt5mys6i27rezbm6py'),
  ABHIBUS_COLLECTOR_ID: z.string().default('c_mt494k6m154fl23cty'),
  BRIGHTDATA_CLI_BIN: z.string().default('bdata'),
  SELF_HEALING_CLI_TIMEOUT_SEC: z.coerce.number().int().positive().default(1800),
  SELF_HEALING_OUTPUT_DIR: z.string().default('output'),
  BRIGHT_DATA_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  BRIGHT_DATA_MAX_POLL_ATTEMPTS: z.coerce.number().int().positive().default(60),
  BRIGHT_DATA_SOURCE_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  SCRAPER_DEFAULT_LIMIT: z.coerce.number().int().positive().default(10),
  ABHIBUS_RESULT_LIMIT: z.coerce.number().int().positive().default(10),
  PROVIDER_CACHE_FRESH_MS: z.coerce.number().int().positive().default(600_000),
  PROVIDER_CACHE_STALE_MS: z.coerce.number().int().positive().default(900_000),
  PROVIDER_RETRY_COOLDOWN_MS: z.coerce.number().int().positive().default(900_000),
  DEFAULT_PAGE_LIMIT: z.coerce.number().int().positive().default(20),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function loadEnv(overrides?: Record<string, string | undefined>): Env {
  const merged = { ...process.env, ...overrides };
  // Accept BRIGHTDATA_API_KEY as alias for BRIGHT_DATA_API_TOKEN
  if (!merged.BRIGHT_DATA_API_TOKEN && merged.BRIGHTDATA_API_KEY) {
    merged.BRIGHT_DATA_API_TOKEN = merged.BRIGHTDATA_API_KEY;
  }
  // Fall back to Bright Data CLI credentials (~/.config or %APPDATA%/brightdata-cli)
  if (!merged.BRIGHT_DATA_API_TOKEN) {
    const fromCli = loadBrightDataApiTokenFromCli();
    if (fromCli) {
      merged.BRIGHT_DATA_API_TOKEN = fromCli;
    }
  }
  const parsed = envSchema.safeParse(merged);
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
