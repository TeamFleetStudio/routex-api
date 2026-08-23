import type { CanonicalBus } from './bus.types.js';
import type { SourceResultMeta } from './source.types.js';
import type { ProviderProgressEntry } from './search-session.types.js';
import type { PaginationMeta } from '../utils/pagination.js';

export type SearchStatus = 'SUCCESS' | 'PARTIAL_SUCCESS' | 'SEARCH_FAILED';

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
  };
  request_id: string;
}

export interface BusSearchResponse {
  success: boolean;
  status: SearchStatus;
  request_id: string;
  search_id: string;
  cache?: {
    hit: boolean;
    stale: boolean;
  };
  sources: SourceResultMeta[];
  results: CanonicalBus[];
  total_buses: number;
  pagination: PaginationMeta;
  updating_more_results?: boolean;
}

export interface HealthResponse {
  status: 'UP' | 'DOWN';
  redis?: 'CONNECTED' | 'DISCONNECTED';
}

export interface SearchStatusResponse {
  search_id: string;
  status: SearchStatus;
  request_id: string;
  total_providers: number;
  completed: number;
  processing: number;
  failed: number;
  skipped: number;
  progress_percent: number;
  providers: Record<string, ProviderProgressEntry>;
  total_buses: number;
  updating_more_results: boolean;
}
