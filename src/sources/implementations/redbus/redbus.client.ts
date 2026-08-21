import type { BusSearchRequest } from '../../../types/bus.types.js';
import type { RawSourceResult } from '../../../types/source.types.js';
import type { BusSourceClient } from '../../contracts/bus-source-client.interface.js';
import { ExternalApiError } from '../../../errors/index.js';
import { nowIso } from '../../../utils/time.js';
import type { BrightDataClient } from '../brightdata/bright-data.client.js';
import { buildRedBusSearchUrl } from '../brightdata/url-builders.js';

export class RedBusSourceClient implements BusSourceClient {
  readonly sourceName = 'redbus';

  constructor(
    private readonly brightData: BrightDataClient,
    private readonly collectorId: string,
  ) {}

  async search(searchRequest: BusSearchRequest): Promise<RawSourceResult> {
    const url = buildRedBusSearchUrl(
      searchRequest.from_city,
      searchRequest.to_city,
      searchRequest.travel_date,
    );

    if (!url) {
      throw new ExternalApiError(
        this.sourceName,
        `Unknown RedBus city id for "${searchRequest.from_city}" → "${searchRequest.to_city}"`,
        400,
      );
    }

    const records = await this.brightData.collect(this.collectorId, [{ url }]);

    return {
      source: this.sourceName,
      payload: { records, mode: 'brightdata' },
      fetched_at: nowIso(),
    };
  }
}
