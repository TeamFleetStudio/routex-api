import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Env } from '../../config/env.js';
import type { BusSearchRequest } from '../../types/bus.types.js';
import type { FailureKind } from '../../types/source.types.js';
import { logger } from '../../utils/logger.js';
import {
  buildSourceSearchUrl,
  type BrightDataSite,
} from '../../sources/implementations/brightdata/bright-data-input.builder.js';

export interface BrightDataCliHealContext {
  source: string;
  collectorId: string;
  search: BusSearchRequest;
  failure_kind: FailureKind;
  message?: string;
}

export interface BrightDataCliHealResult {
  success: boolean;
  outputPath: string;
  command: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

const BRIGHT_DATA_SITES = new Set<string>(['redbus', 'makemytrip']);

export function isBrightDataSource(source: string): source is BrightDataSite {
  return BRIGHT_DATA_SITES.has(source);
}

export function buildHealPrompt(context: BrightDataCliHealContext): string {
  const route = `${context.search.from_city} → ${context.search.to_city} on ${context.search.travel_date}`;
  const issue =
    context.message?.trim() ||
    `${context.source} failed with ${context.failure_kind} for route ${route}.`;
  const fixHint =
    ' Fix the bus scraper to extract operator_name, price_inr, listing_url, duration_minutes, boarding_points, and dropping_points from the search results page.';
  return `${issue}${fixHint}`.slice(0, 1000);
}

export function buildHealOutputPath(env: Env, source: string): string {
  return join(env.SELF_HEALING_OUTPUT_DIR, `${source}-heal.json`);
}

export async function runBrightDataScraperHeal(
  env: Env,
  context: BrightDataCliHealContext,
): Promise<BrightDataCliHealResult> {
  const url = buildSourceSearchUrl(context.source as BrightDataSite, context.search);
  const prompt = buildHealPrompt(context);
  const outputPath = buildHealOutputPath(env, context.source);

  await mkdir(env.SELF_HEALING_OUTPUT_DIR, { recursive: true });

  const args = [
    'scraper',
    'heal',
    context.collectorId,
    prompt,
    '--auto-approve',
    '--auto-save',
    '--timeout',
    String(env.SELF_HEALING_CLI_TIMEOUT_SEC),
    '--pretty',
    '-o',
    outputPath,
  ];

  if (url) {
    args.push('--url', url);
  }

  const command = [env.BRIGHTDATA_CLI_BIN, ...args];

  logger.info({
    event: 'SELF_HEALING_CLI_STARTED',
    source: context.source,
    collector_id: context.collectorId,
    url,
    output_path: outputPath,
    timeout_sec: env.SELF_HEALING_CLI_TIMEOUT_SEC,
    command: buildCommandLine(env.BRIGHTDATA_CLI_BIN, args),
  });

  const { exitCode, stdout, stderr } = await spawnAndCollect(
    env.BRIGHTDATA_CLI_BIN,
    args,
    env.SELF_HEALING_CLI_TIMEOUT_SEC * 1000 + 60_000,
  );

  const success = exitCode === 0;

  if (success) {
    logger.info({
      event: 'SELF_HEALING_CLI_SUCCESS',
      source: context.source,
      collector_id: context.collectorId,
      output_path: outputPath,
      exit_code: exitCode,
    });
  } else {
    logger.error({
      event: 'SELF_HEALING_CLI_FAILED',
      source: context.source,
      collector_id: context.collectorId,
      exit_code: exitCode,
      stderr: stderr.slice(0, 2000),
    });
  }

  return {
    success,
    outputPath,
    command,
    exitCode,
    stdout,
    stderr,
  };
}

function quoteCmdArg(arg: string): string {
  if (!/[\s"&|<>^()]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

function buildCommandLine(bin: string, args: string[]): string {
  return [bin, ...args.map(quoteCmdArg)].join(' ');
}

function spawnAndCollect(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child =
      process.platform === 'win32'
        ? spawn(buildCommandLine(bin, args), {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: true,
            windowsHide: true,
          })
        : spawn(bin, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
          });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Bright Data CLI heal timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
  });
}
