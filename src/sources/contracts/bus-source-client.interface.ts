import type { BusSearchRequest } from '../../types/bus.types.js';
import type { RawSourceResult } from '../../types/source.types.js';

export interface BusSourceClient {
  readonly sourceName: string;
  search(request: BusSearchRequest): Promise<RawSourceResult>;
}
