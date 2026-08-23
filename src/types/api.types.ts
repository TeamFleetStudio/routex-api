import type { CanonicalBus } from './bus.types.js';
import type { SourceResultMeta } from './source.types.js';
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
