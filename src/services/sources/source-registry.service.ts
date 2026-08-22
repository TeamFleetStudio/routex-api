import type { RedisClient } from '../../config/redis.js';
import type { Env } from '../../config/env.js';
import type { SourceConfig } from '../../types/source.types.js';
import { SOURCES_CONFIG_KEY } from '../../utils/cache-key.js';
import type { BusSourceClient } from '../../sources/contracts/bus-source-client.interface.js';

const BRIGHT_DATA_SOURCES = new Set(['redbus', 'abhibus']);
const REMOVED_SOURCES = new Set(['makemytrip', 'goibibo', 'ixigo']);

export class SourceRegistryService {
  private clients = new Map<string, BusSourceClient>();

  constructor(
    private readonly redis: RedisClient,
    private readonly env: Env,
  ) {}

  registerClient(client: BusSourceClient): void {
    this.clients.set(client.sourceName, client);
  }

  async seedDefaultsIfMissing(): Promise<void> {
    const existing = await this.redis.get(SOURCES_CONFIG_KEY);
    if (existing) {
      await this.ensureBrightDataConfig(JSON.parse(existing) as SourceConfig[]);
      return;
    }

    await this.redis.set(SOURCES_CONFIG_KEY, JSON.stringify(this.defaultConfigs()));
  }

  private defaultConfigs(): SourceConfig[] {
    const brightTimeout = this.env.BRIGHT_DATA_SOURCE_TIMEOUT_MS;
    const retry = Math.min(1, this.env.DEFAULT_SOURCE_RETRY_COUNT);
    const brightBase = 'ENV_REFERENCE:BRIGHT_DATA_BASE_URL';

    return [
      {
        name: 'redbus',
        enabled: true,
        base_url: brightBase,
        timeout_ms: brightTimeout,
        retry_count: retry,
        priority: 1,
        self_healing_enabled: true,
      },
      {
        name: 'abhibus',
        enabled: true,
        base_url: brightBase,
        timeout_ms: brightTimeout,
        retry_count: retry,
        priority: 2,
        self_healing_enabled: true,
      },
    ];
  }

  /** Migrate cached config: drop removed sources and sync Bright Data settings. */
  private async ensureBrightDataConfig(configs: SourceConfig[]): Promise<void> {
    const brightTimeout = this.env.BRIGHT_DATA_SOURCE_TIMEOUT_MS;
    const brightBase = 'ENV_REFERENCE:BRIGHT_DATA_BASE_URL';
    let changed = false;

    const withoutRemoved = configs.filter((c) => !REMOVED_SOURCES.has(c.name));
    if (withoutRemoved.length !== configs.length) {
      changed = true;
    }

    const byName = new Map(withoutRemoved.map((c) => [c.name, c]));
    for (const def of this.defaultConfigs()) {
      const existing = byName.get(def.name);
      if (!existing) {
        byName.set(def.name, def);
        changed = true;
        continue;
      }
      if (
        BRIGHT_DATA_SOURCES.has(existing.name) &&
        (existing.timeout_ms < brightTimeout || existing.base_url !== brightBase)
      ) {
        byName.set(def.name, {
          ...existing,
          timeout_ms: brightTimeout,
          base_url: brightBase,
          self_healing_enabled: existing.self_healing_enabled ?? true,
        });
        changed = true;
      }
    }

    if (changed) {
      const next = [...byName.values()].sort((a, b) => a.priority - b.priority);
      await this.redis.set(SOURCES_CONFIG_KEY, JSON.stringify(next));
    }
  }

  async getAllConfigs(): Promise<SourceConfig[]> {
    const raw = await this.redis.get(SOURCES_CONFIG_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SourceConfig[];
  }

  async getEnabledSources(): Promise<
    Array<{ config: SourceConfig; client: BusSourceClient }>
  > {
    const configs = await this.getAllConfigs();
    return configs
      .filter((c) => c.enabled && !REMOVED_SOURCES.has(c.name))
      .sort((a, b) => a.priority - b.priority)
      .map((config) => {
        const client = this.clients.get(config.name);
        if (!client) return null;
        return { config, client };
      })
      .filter((x): x is { config: SourceConfig; client: BusSourceClient } => x !== null);
  }

  getClient(name: string): BusSourceClient | undefined {
    return this.clients.get(name);
  }
}
