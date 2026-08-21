import type { BusSearchRequest, NormalizedBusListing } from '../../types/bus.types.js';

export interface SourceAdapter<TRaw = unknown> {
  readonly sourceName: string;
  adapt(raw: TRaw, search: BusSearchRequest): NormalizedBusListing[];
}
