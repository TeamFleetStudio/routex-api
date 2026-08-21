export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly isOperational: boolean;

  constructor(
    message: string,
    options: { code: string; statusCode?: number; isOperational?: boolean; cause?: unknown } = {
      code: 'INTERNAL_ERROR',
    },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = this.constructor.name;
    this.code = options.code;
    this.statusCode = options.statusCode ?? 500;
    this.isOperational = options.isOperational ?? true;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: 'VALIDATION_ERROR', statusCode: 400, cause });
  }
}

export class RateLimitExceededError extends AppError {
  constructor(message = 'Too many requests. Please try again later.') {
    super(message, { code: 'RATE_LIMIT_EXCEEDED', statusCode: 429 });
  }
}

export class ExternalApiError extends AppError {
  readonly source: string;

  constructor(source: string, message: string, statusCode = 502, cause?: unknown) {
    super(message, { code: 'EXTERNAL_API_ERROR', statusCode, cause });
    this.source = source;
  }
}

export class SourceTimeoutError extends AppError {
  readonly source: string;

  constructor(source: string, message = 'Source request timed out', cause?: unknown) {
    super(message, { code: 'SOURCE_TIMEOUT', statusCode: 504, cause });
    this.source = source;
  }
}

export class SourceUnavailableError extends AppError {
  readonly source: string;

  constructor(source: string, message = 'Source is temporarily unavailable', cause?: unknown) {
    super(message, { code: 'SOURCE_UNAVAILABLE', statusCode: 503, cause });
    this.source = source;
  }
}

export class NormalizationError extends AppError {
  readonly source: string;

  constructor(source: string, message: string, cause?: unknown) {
    super(message, { code: 'NORMALIZATION_ERROR', statusCode: 502, cause });
    this.source = source;
  }
}

export class CacheError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: 'CACHE_ERROR', statusCode: 500, cause });
  }
}

export class SelfHealingError extends AppError {
  readonly source: string;

  constructor(source: string, message: string, cause?: unknown) {
    super(message, { code: 'SELF_HEALING_ERROR', statusCode: 502, cause });
    this.source = source;
  }
}
