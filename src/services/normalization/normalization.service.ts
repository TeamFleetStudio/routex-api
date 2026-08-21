import type { BusSearchRequest, NormalizedBusListing } from '../../types/bus.types.js';
import type { SourceAdapter } from '../../sources/contracts/source-adapter.interface.js';
import { NormalizationError } from '../../errors/index.js';
import { logger } from '../../utils/logger.js';

export class NormalizationService {
  private adapters = new Map<string, SourceAdapter>();

  register(adapter: SourceAdapter): void {
    this.adapters.set(adapter.sourceName, adapter);
  }

  normalize(source: string, raw: unknown, search: BusSearchRequest): NormalizedBusListing[] {
    const adapter = this.adapters.get(source);
    if (!adapter) {
      throw new NormalizationError(source, `No adapter registered for source: ${source}`);
    }

    try {
      const listings = adapter.adapt(raw, search);
      logger.info({
        event: 'NORMALIZATION_COMPLETED',
        source,
        count: listings.length,
      });
      return listings;
    } catch (err) {
      logger.error({
        event: 'NORMALIZATION_FAILED',
        source,
        message: err instanceof Error ? err.message : 'unknown',
      });
      throw new NormalizationError(source, 'Failed to normalize provider response', err);
    }
  }
}
