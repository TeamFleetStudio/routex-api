import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ProviderAnalyticsService } from '../services/analytics/provider-analytics.service.js';
import type { SourceRegistryService } from '../services/sources/source-registry.service.js';
import type { SourceHealthService } from '../services/sources/source-health.service.js';

export class AnalyticsController {
  constructor(
    private readonly analytics: ProviderAnalyticsService,
    private readonly registry: SourceRegistryService,
    private readonly health: SourceHealthService,
  ) {}

  async getProviderAnalytics(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const sources = await this.registry.getEnabledSources();
    const names = sources.map((s) => s.config.name);
    const counters = await this.analytics.getAll(names);
    const healthRecords = await Promise.all(names.map((n) => this.health.get(n)));

    const providers = counters.map((record, i) => ({
      ...record,
      health: healthRecords[i],
    }));

    await reply.status(200).send({
      success: true,
      providers,
      generated_at: new Date().toISOString(),
    });
  }
}
