import type { BusSearchRequest, CanonicalBus } from './bus.types.js';
import type { SearchStatus } from './api.types.js';
import type { SourceResultMeta } from './source.types.js';

export interface SearchSession {
  search_id: string;
  request: BusSearchRequest;
  status: SearchStatus;
  sources: SourceResultMeta[];
  results: CanonicalBus[];
  total_buses: number;
  created_at: string;
  updated_at: string;
  fresh_until: string;
  stale_until: string;
}
