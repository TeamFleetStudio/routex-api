import type { BusSearchRequest, CanonicalBus } from './bus.types.js';
import type { SearchStatus } from './api.types.js';
import type { SourceResultMeta, SourceExecutionStatus } from './source.types.js';

export type ProviderProgressStatus = SourceExecutionStatus | 'processing';

export interface ProviderProgressEntry {
  status: ProviderProgressStatus;
  cache_status?: SourceResultMeta['cache_status'];
  bus_count?: number;
  message?: string;
}

export interface SearchSession {
  search_id: string;
  request: BusSearchRequest;
  status: SearchStatus;
  sources: SourceResultMeta[];
  results: CanonicalBus[];
  total_buses: number;
  total_providers?: number;
  provider_progress?: Record<string, ProviderProgressEntry>;
  created_at: string;
  updated_at: string;
  fresh_until: string;
  stale_until: string;
}
