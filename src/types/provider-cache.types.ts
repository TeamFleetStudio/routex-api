import type { NormalizedBusListing } from './bus.types.js';
import type { FailureKind } from './source.types.js';

export type ProviderCacheStatus = 'success' | 'failed';

export interface ProviderCacheEntry {
  provider: string;
  status: ProviderCacheStatus;
  listings: NormalizedBusListing[];
  last_fetched_at: string;
  fresh_until: string;
  stale_until: string;
  retry_after?: string;
  failure_kind?: FailureKind;
  message?: string;
}
