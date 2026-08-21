import type { RedisClient } from '../../config/redis.js';
import type { Env } from '../../config/env.js';
import type { SourceConfig } from '../../types/source.types.js';
import { SOURCES_CONFIG_KEY } from '../../utils/cache-key.js';
import type { BusSourceClient } from '../../sources/contracts/bus-source-client.interface.js';

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
      await this.ensureBrightDataTimeouts(JSON.parse(existing) as SourceConfig[]);
      return;
    }

    const brightTimeout = this.env.BRIGHT_DATA_SOURCE_TIMEOUT_MS;
    const defaults: SourceConfig[] = [
      {
        name: 'redbus',
        enabled: true,
        base_url: 'ENV_REFERENCE:BRIGHT_DATA_BASE_URL',
        timeout_ms: brightTimeout,
        retry_count: Math.min(1, this.env.DEFAULT_SOURCE_RETRY_COUNT),
        priority: 1,
        self_healing_enabled: true,
      },
      {
        name: 'abhibus',
        enabled: true,
        base_url: 'ENV_REFERENCE:BRIGHT_DATA_BASE_URL',
        timeout_ms: brightTimeout,
        retry_count: Math.min(1, this.env.DEFAULT_SOURCE_RETRY_COUNT),
        priority: 2,
        self_healing_enabled: true,
      },
      {
        name: 'makemytrip',
        enabled: true,
        base_url: 'ENV_REFERENCE:MMT_API_URL',
        timeout_ms: this.env.DEFAULT_SOURCE_TIMEOUT_MS,
        retry_count: this.env.DEFAULT_SOURCE_RETRY_COUNT,
        priority: 3,
        self_healing_enabled: true,
      },
    ];

    await this.redis.set(SOURCES_CONFIG_KEY, JSON.stringify(defaults));
  }

  /** Ensure RedBus/AbhiBus timeouts cover Bright Data poll windows. */
  private async ensureBrightDataTimeouts(configs: SourceConfig[]): Promise<void> {
    const brightTimeout = this.env.BRIGHT_DATA_SOURCE_TIMEOUT_MS;
    let changed = false;
    const next = configs.map((c) => {
      if ((c.name === 'redbus' || c.name === 'abhibus') && c.timeout_ms < brightTimeout) {
        changed = true;
        return { ...c, timeout_ms: brightTimeout, base_url: 'ENV_REFERENCE:BRIGHT_DATA_BASE_URL' };
      }
      return c;
    });
    if (changed) {
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
      .filter((c) => c.enabled)
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
