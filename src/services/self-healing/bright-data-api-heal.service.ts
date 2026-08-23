import { request } from 'undici';
import type { Env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { sleep } from '../../utils/time.js';
import {
  buildSourceSearchUrl,
  type BrightDataSite,
} from '../../sources/implementations/brightdata/bright-data-input.builder.js';
import {
  buildHealPrompt,
  type BrightDataHealContext,
  type BrightDataHealResult,
} from './bright-data-heal.util.js';

interface HealProgressResponse {
  status?: string;
  step?: string;
  completed_steps?: number;
  message?: string;
}

const TERMINAL_FAILURE = new Set(['failed', 'error', 'cancelled', 'rejected']);

export async function runBrightDataApiHeal(
  env: Env,
  context: BrightDataHealContext,
): Promise<BrightDataHealResult> {
  const apiToken = env.BRIGHT_DATA_API_TOKEN;
  if (!apiToken) {
    return { success: false, mode: 'api', message: 'BRIGHT_DATA_API_TOKEN is not configured' };
  }

  const baseUrl = env.BRIGHT_DATA_BASE_URL.replace(/\/$/, '');
  const collectorId = context.collectorId;
  const pageUrl = buildSourceSearchUrl(context.source as BrightDataSite, context.search);
  const prompt = buildHealPrompt(context);
  const pollIntervalMs = env.BRIGHT_DATA_POLL_INTERVAL_MS;
  const timeoutMs = env.SELF_HEALING_CLI_TIMEOUT_SEC * 1000;
  const deadline = Date.now() + timeoutMs;

  logger.info({
    event: 'SELF_HEALING_API_STARTED',
    source: context.source,
    collector_id: collectorId,
    url: pageUrl,
    timeout_sec: env.SELF_HEALING_CLI_TIMEOUT_SEC,
  });

  try {
    await apiRequest(baseUrl, apiToken, 'POST', healTriggerPath(collectorId), {
      prompt,
      custom_input: pageUrl ? [{ url: pageUrl }] : [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'trigger failed';
    logger.error({
      event: 'SELF_HEALING_API_FAILED',
      source: context.source,
      collector_id: collectorId,
      phase: 'trigger',
      message,
    });
    return { success: false, mode: 'api', message };
  }

  let approvalSent = false;

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);

    let progress: HealProgressResponse;
    try {
      progress = await apiRequest<HealProgressResponse>(
        baseUrl,
        apiToken,
        'GET',
        healProgressPath(collectorId),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'progress poll failed';
      logger.warn({
        event: 'SELF_HEALING_API_PROGRESS_ERROR',
        source: context.source,
        collector_id: collectorId,
        message,
      });
      continue;
    }

    const status = progress.status?.toLowerCase() ?? '';
    const step = progress.step?.toLowerCase() ?? '';

    logger.info({
      event: 'SELF_HEALING_API_PROGRESS',
      source: context.source,
      collector_id: collectorId,
      status,
      step,
      completed_steps: progress.completed_steps,
    });

    if (status === 'pending_answer' && step === 'user_approval' && !approvalSent) {
      try {
        await apiRequest(baseUrl, apiToken, 'POST', resumeJobPath(collectorId), {
          message: true,
          auto_save: true,
        });
        approvalSent = true;
        logger.info({
          event: 'SELF_HEALING_API_APPROVED',
          source: context.source,
          collector_id: collectorId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'approve failed';
        logger.error({
          event: 'SELF_HEALING_API_FAILED',
          source: context.source,
          collector_id: collectorId,
          phase: 'approve',
          message,
        });
        return { success: false, mode: 'api', message };
      }
      continue;
    }

    if (status === 'done') {
      logger.info({
        event: 'SELF_HEALING_API_SUCCESS',
        source: context.source,
        collector_id: collectorId,
      });
      return { success: true, mode: 'api' };
    }

    if (TERMINAL_FAILURE.has(status)) {
      const message = progress.message ?? status;
      logger.error({
        event: 'SELF_HEALING_API_FAILED',
        source: context.source,
        collector_id: collectorId,
        phase: 'progress',
        status,
        message,
      });
      return { success: false, mode: 'api', message };
    }
  }

  logger.error({
    event: 'SELF_HEALING_API_FAILED',
    source: context.source,
    collector_id: collectorId,
    phase: 'timeout',
    timeout_sec: env.SELF_HEALING_CLI_TIMEOUT_SEC,
  });
  return { success: false, mode: 'api', message: 'heal timed out' };
}

function healTriggerPath(collectorId: string): string {
  return `/dca/collectors/${encodeURIComponent(collectorId)}/refactor_template`;
}

function healProgressPath(collectorId: string): string {
  return `/dca/collectors/${encodeURIComponent(collectorId)}/refactor_template/progress`;
}

function resumeJobPath(collectorId: string): string {
  return `/dca/collectors/${encodeURIComponent(collectorId)}/resume_automation_job`;
}

async function apiRequest<T = unknown>(
  baseUrl: string,
  apiToken: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiToken}`,
    accept: 'application/json',
  };

  let res;
  try {
    res = await request(url, {
      method,
      headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(`Bright Data heal network error: ${err instanceof Error ? err.message : 'unknown'}`);
  }

  const text = await res.body.text();

  if (res.statusCode >= 400) {
    throw new Error(
      `Bright Data heal ${method} ${path} failed (${res.statusCode}): ${text.slice(0, 500)}`,
    );
  }

  if (!text.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Bright Data heal returned invalid JSON from ${path}`);
  }
}
