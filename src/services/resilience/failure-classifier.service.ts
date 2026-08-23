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
        mayTriggerSelfHealing: true,
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
          mayTriggerSelfHealing: true,
          message: error.message,
        };
      }
      // Bright Data trigger 422 (output_schema_incompatible) is NOT a scrape/HTML
      // structure change — do not label it RESPONSE_STRUCTURE_CHANGED.
      if (status === 422) {
        const msg = error.message.toLowerCase();
        if (
          msg.includes('output_schema') ||
          msg.includes('incompatible') ||
          msg.includes('trigger failed') ||
          msg.includes('override_incompatible')
        ) {
          return {
            kind: 'INVALID_RESPONSE',
            retryable: false,
            mayTriggerSelfHealing: true,
            message: `Bright Data collector schema incompatible (trigger): ${error.message}`,
          };
        }
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
        mayTriggerSelfHealing: true,
        message: error.message,
      };
    }

    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('timeout') || msg.includes('aborted')) {
        return {
          kind: 'TIMEOUT',
          retryable: true,
          mayTriggerSelfHealing: true,
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
          mayTriggerSelfHealing: true,
          message: error.message,
        };
      }
      // Trigger schema mismatches — not HTML/DOM structure changes.
      if (
        msg.includes('output_schema') ||
        msg.includes('incompatible_schema') ||
        (msg.includes('trigger failed') && msg.includes('422'))
      ) {
        return {
          kind: 'INVALID_RESPONSE',
          retryable: false,
          mayTriggerSelfHealing: true,
          message: `Bright Data collector schema incompatible (trigger): ${error.message}`,
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
      mayTriggerSelfHealing: true,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
