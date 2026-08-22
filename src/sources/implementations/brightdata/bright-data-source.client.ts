import type { BusSearchRequest } from '../../../types/bus.types.js';
import type { RawSourceResult } from '../../../types/source.types.js';
import type { BusSourceClient } from '../../contracts/bus-source-client.interface.js';
import { ExternalApiError } from '../../../errors/index.js';
import { nowIso } from '../../../utils/time.js';
import type { BrightDataClient } from '../brightdata/bright-data.client.js';
import {
  buildBrightDataInputs,
  type BrightDataSite,
} from '../brightdata/bright-data-input.builder.js';

export class BrightDataSourceClient implements BusSourceClient {
  readonly sourceName: string;

  constructor(
    private readonly site: BrightDataSite,
    private readonly brightData: BrightDataClient,
    private readonly collectorId: string,
    private readonly limit: number,
  ) {
    this.sourceName = site;
  }

  async search(searchRequest: BusSearchRequest): Promise<RawSourceResult> {
    let inputs: unknown[];
    try {
      inputs = buildBrightDataInputs(this.site, searchRequest, this.limit);
    } catch (err) {
      throw new ExternalApiError(
        this.sourceName,
        err instanceof Error ? err.message : 'Invalid search for source',
        400,
        err,
      );
    }

    const records = await this.brightData.collect(this.collectorId, inputs);

    return {
      source: this.sourceName,
      payload: records,
      fetched_at: nowIso(),
    };
  }
}
