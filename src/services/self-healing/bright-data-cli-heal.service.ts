import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import {
  buildSourceSearchUrl,
  type BrightDataSite,
} from '../../sources/implementations/brightdata/bright-data-input.builder.js';
import {
  buildHealPrompt,
  type BrightDataHealContext,
  type BrightDataHealResult,
} from './bright-data-heal.util.js';

export type { BrightDataHealContext };

/** Local-dev fallback: runs `bdata scraper heal` when CLI is installed. */
export async function runBrightDataCliHeal(
  env: Env,
  context: BrightDataHealContext,
): Promise<BrightDataHealResult> {
  const url = buildSourceSearchUrl(context.source as BrightDataSite, context.search);
  const prompt = buildHealPrompt(context);
  const outputPath = join(env.SELF_HEALING_OUTPUT_DIR, `${context.source}-heal.json`);

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

  logger.info({
    event: 'SELF_HEALING_CLI_STARTED',
    source: context.source,
    collector_id: context.collectorId,
    url,
    output_path: outputPath,
    timeout_sec: env.SELF_HEALING_CLI_TIMEOUT_SEC,
  });

  const { exitCode, stderr } = await spawnAndCollect(
    env.BRIGHTDATA_CLI_BIN,
    args,
    env.SELF_HEALING_CLI_TIMEOUT_SEC * 1000 + 60_000,
  );

  if (exitCode === 0) {
    logger.info({
      event: 'SELF_HEALING_CLI_SUCCESS',
      source: context.source,
      collector_id: context.collectorId,
      output_path: outputPath,
    });
    return { success: true, mode: 'cli', outputPath };
  }

  logger.error({
    event: 'SELF_HEALING_CLI_FAILED',
    source: context.source,
    collector_id: context.collectorId,
    exit_code: exitCode,
    stderr: stderr.slice(0, 2000),
  });
  return { success: false, mode: 'cli', message: stderr.slice(0, 500), outputPath };
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
