import type { BusSearchRequest } from '../../../types/bus.types.js';
import type { RawSourceResult } from '../../../types/source.types.js';
import type { BusSourceClient } from '../../contracts/bus-source-client.interface.js';
import { nowIso } from '../../../utils/time.js';
import type { BrightDataClient } from '../brightdata/bright-data.client.js';
import { buildAbhiBusSearchUrl } from '../brightdata/url-builders.js';

export class AbhiBusSourceClient implements BusSourceClient {
  readonly sourceName = 'abhibus';

  constructor(
    private readonly brightData: BrightDataClient,
    private readonly collectorId: string,
    private readonly limit: number,
  ) {}

  async search(searchRequest: BusSearchRequest): Promise<RawSourceResult> {
    const url = buildAbhiBusSearchUrl(searchRequest.from_city, searchRequest.to_city);
    const records = await this.brightData.collect(this.collectorId, [
      { url, limit: this.limit },
    ]);

    return {
      source: this.sourceName,
      payload: { records, mode: 'brightdata' },
      fetched_at: nowIso(),
    };
  }
}
