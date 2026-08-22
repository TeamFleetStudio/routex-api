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
    if (existing) return;

    const bdRedbus = Boolean(this.env.BRIGHTDATA_API_KEY && this.env.COLLECTOR_REDBUS);
    const defaults: SourceConfig[] = [
      {
        name: 'redbus',
        enabled: true,
        base_url: bdRedbus ? 'ENV_REFERENCE:BRIGHTDATA' : 'ENV_REFERENCE:REDBUS_API_URL',
        timeout_ms: bdRedbus ? this.env.BRIGHTDATA_TIMEOUT_MS : this.env.DEFAULT_SOURCE_TIMEOUT_MS,
        retry_count: bdRedbus ? 0 : this.env.DEFAULT_SOURCE_RETRY_COUNT,
        priority: 1,
        self_healing_enabled: !bdRedbus,
      },
      {
        name: 'abhibus',
        enabled: !bdRedbus,
        base_url: 'ENV_REFERENCE:ABHIBUS_API_URL',
        timeout_ms: this.env.DEFAULT_SOURCE_TIMEOUT_MS,
        retry_count: this.env.DEFAULT_SOURCE_RETRY_COUNT,
        priority: 2,
        self_healing_enabled: true,
      },
      {
        name: 'makemytrip',
        enabled: !bdRedbus,
        base_url: 'ENV_REFERENCE:MMT_API_URL',
        timeout_ms: this.env.DEFAULT_SOURCE_TIMEOUT_MS,
        retry_count: this.env.DEFAULT_SOURCE_RETRY_COUNT,
        priority: 3,
        self_healing_enabled: true,
      },
    ];

    await this.redis.set(SOURCES_CONFIG_KEY, JSON.stringify(defaults));
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
