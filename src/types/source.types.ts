export type SourceHealthState =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'UNHEALTHY'
  | 'HEALING'
  | 'DISABLED';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export type FailureKind =
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR'
  | 'INVALID_RESPONSE'
  | 'RESPONSE_STRUCTURE_CHANGED'
  | 'DATA_EXTRACTION_FAILED'
  | 'INVALID_REQUEST'
  | 'UNKNOWN';

export type SourceExecutionStatus =
  | 'SUCCESS'
  | 'TIMEOUT'
  | 'FAILED'
  | 'SKIPPED'
  | 'CIRCUIT_OPEN';

export interface SourceConfig {
  name: string;
  enabled: boolean;
  base_url: string;
  timeout_ms: number;
  retry_count: number;
  priority: number;
  self_healing_enabled: boolean;
}

export interface SourceHealthRecord {
  state: SourceHealthState;
  success_count: number;
  failure_count: number;
  consecutive_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error_code: FailureKind | null;
}

export interface CircuitBreakerRecord {
  state: CircuitState;
  failure_count: number;
  opened_at: string | null;
  half_open_at: string | null;
  last_failure_at: string | null;
}

export interface RawSourceResult {
  source: string;
  payload: unknown;
  fetched_at: string;
}

export interface SourceResultMeta {
  source: string;
  status: SourceExecutionStatus;
  failure_kind?: FailureKind;
  message?: string;
  duration_ms: number;
}
