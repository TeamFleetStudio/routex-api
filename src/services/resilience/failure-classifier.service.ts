import type { FailureKind } from '../../types/source.types.js';
import {
  ExternalApiError,
  NormalizationError,
  SourceTimeoutError,
  ValidationError,
} from '../../errors/index.js';

export interface ClassifiedFailure {
  kind: FailureKind;
  retryable: boolean;
  mayTriggerSelfHealing: boolean;
  retryAfterMs?: number;
  message: string;
}

export class FailureClassifierService {
  classify(error: unknown): ClassifiedFailure {
    if (error instanceof SourceTimeoutError) {
      return {
        kind: 'TIMEOUT',
        retryable: true,
        mayTriggerSelfHealing: false,
        message: error.message,
      };
    }

    if (error instanceof ValidationError) {
      return {
        kind: 'INVALID_REQUEST',
        retryable: false,
        mayTriggerSelfHealing: false,
        message: error.message,
      };
    }

    if (error instanceof NormalizationError) {
      return {
        kind: 'DATA_EXTRACTION_FAILED',
        retryable: false,
        mayTriggerSelfHealing: true,
        message: error.message,
      };
    }

    if (error instanceof ExternalApiError) {
      const status = error.statusCode;
      if (status === 429) {
        return {
          kind: 'RATE_LIMITED',
          retryable: true,
          mayTriggerSelfHealing: false,
          message: error.message,
        };
      }
      if (status >= 500) {
        return {
          kind: 'SERVER_ERROR',
          retryable: true,
          mayTriggerSelfHealing: false,
          message: error.message,
        };
      }
      if (status === 422) {
        return {
          kind: 'RESPONSE_STRUCTURE_CHANGED',
          retryable: false,
          mayTriggerSelfHealing: true,
          message: error.message,
        };
      }
      return {
        kind: 'INVALID_RESPONSE',
        retryable: false,
        mayTriggerSelfHealing: false,
        message: error.message,
      };
    }

    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('timeout') || msg.includes('aborted')) {
        return {
          kind: 'TIMEOUT',
          retryable: true,
          mayTriggerSelfHealing: false,
          message: error.message,
        };
      }
      if (
        msg.includes('econnrefused') ||
        msg.includes('enotfound') ||
        msg.includes('network') ||
        msg.includes('fetch failed')
      ) {
        return {
          kind: 'NETWORK_ERROR',
          retryable: true,
          mayTriggerSelfHealing: false,
          message: error.message,
        };
      }
      if (msg.includes('structure') || msg.includes('schema')) {
        return {
          kind: 'RESPONSE_STRUCTURE_CHANGED',
          retryable: false,
          mayTriggerSelfHealing: true,
          message: error.message,
        };
      }
    }

    return {
      kind: 'UNKNOWN',
      retryable: false,
      mayTriggerSelfHealing: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
