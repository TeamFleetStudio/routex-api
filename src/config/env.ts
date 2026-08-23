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
  /** Comma-separated allowed browser origins for CORS (no trailing slash) */
  CORS_ORIGINS: z
    .string()
    .default('https://routex.fsgarage.in,http://localhost:5173,http://localhost:3000')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim().replace(/\/$/, ''))
        .filter(Boolean),
    ),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  DEFAULT_SOURCE_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  DEFAULT_SOURCE_RETRY_COUNT: z.coerce.number().int().min(0).default(2),
  CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
  CIRCUIT_COOLDOWN_MS: z.coerce.number().int().positive().default(30_000),
  LOCK_TTL_MS: z.coerce.number().int().positive().default(120_000),
  LOCK_WAIT_MS: z.coerce.number().int().positive().default(30_000),
  LOCK_POLL_MS: z.coerce.number().int().positive().default(250),
  BRIGHT_DATA_API_TOKEN: z.string().optional().default(''),
  BRIGHTDATA_API_KEY: z.string().optional().default(''),
  BRIGHT_DATA_BASE_URL: z.string().default('https://api.brightdata.com'),
  REDBUS_COLLECTOR_ID: z.string().default('c_mt5kcpdj13nspwzrzd'),
  MAKEMYTRIP_COLLECTOR_ID: z.string().default('c_mt5m1h3uvef2inukz'),
  CLEARTrip_COLLECTOR_ID: z.string().default('c_mt5mys6i27rezbm6py'),
  BRIGHTDATA_CLI_BIN: z.string().default('bdata'),
  SELF_HEALING_CLI_TIMEOUT_SEC: z.coerce.number().int().positive().default(1800),
  SELF_HEALING_OUTPUT_DIR: z.string().default('output'),
  BRIGHT_DATA_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  BRIGHT_DATA_MAX_POLL_ATTEMPTS: z.coerce.number().int().positive().default(60),
  /** Append override_incompatible_schema=1 on collector trigger (required for MMT). */
  BRIGHT_DATA_OVERRIDE_INCOMPATIBLE_SCHEMA: z
    .string()
    .optional()
    .transform((v) => v !== 'false' && v !== '0'),
  BRIGHT_DATA_SOURCE_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  SCRAPER_DEFAULT_LIMIT: z.coerce.number().int().positive().default(20),
  PROVIDER_CACHE_FRESH_MS: z.coerce.number().int().positive().default(600_000),
  PROVIDER_CACHE_STALE_MS: z.coerce.number().int().positive().default(900_000),
  PROVIDER_RETRY_COOLDOWN_MS: z.coerce.number().int().positive().default(900_000),
  /**
   * Max time POST /buses/search waits for the first provider before returning
   * (search_id + updating_more_results). Keep low (0–3000) so EasyPanel/Traefik
   * never gateway-timeout with HTML 502. Scrapes continue in background.
   */
  POST_FIRST_RESULT_WAIT_MS: z.coerce.number().int().nonnegative().default(0),
  /** Absolute ceiling for the whole POST handler (ms). Soft-return session if hit. */
  POST_HARD_DEADLINE_MS: z.coerce.number().int().positive().default(2_500),
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
