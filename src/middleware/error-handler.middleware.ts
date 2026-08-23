import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError, RateLimitExceededError, ValidationError } from '../errors/index.js';
import type { ApiErrorBody } from '../types/api.types.js';

function requestIdOf(request: FastifyRequest): string {
  return request.requestId ?? request.id ?? 'unknown';
}

export function toErrorBody(err: unknown, requestId: string): ApiErrorBody {
  if (err instanceof AppError) {
    return {
      success: false,
      error: { code: err.code, message: err.message },
      request_id: requestId,
    };
  }

  if (err instanceof ZodError) {
    const message = err.issues.map((i) => i.message).join('; ') || 'Validation failed';
    return {
      success: false,
      error: { code: 'VALIDATION_ERROR', message },
      request_id: requestId,
    };
  }

  return {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
    request_id: requestId,
  };
}

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const requestId = requestIdOf(request);

  if (error instanceof RateLimitExceededError) {
    request.log.warn({ event: 'RATE_LIMIT_EXCEEDED', request_id: requestId });
    void reply.status(429).send(toErrorBody(error, requestId));
    return;
  }

  if (error instanceof ValidationError || error instanceof ZodError) {
    void reply.status(400).send(toErrorBody(error, requestId));
    return;
  }

  if (error instanceof AppError) {
    request.log.error({
      event: 'APP_ERROR',
      code: error.code,
      message: error.message,
      request_id: requestId,
    });
    // Never return HTTP 502 — proxies/browsers treat it as "gateway down".
    // Provider failures are handled inside search; if an AppError still escapes,
    // use 503 (retryable) or the original non-502 code.
    const status =
      error.statusCode === 502 || error.statusCode === 504 ? 503 : error.statusCode;
    void reply.status(status).send(toErrorBody(error, requestId));
    return;
  }

  const rawStatus =
    'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
  const statusCode = rawStatus === 502 || rawStatus === 504 ? 503 : rawStatus >= 400 ? rawStatus : 500;

  request.log.error({
    event: 'UNHANDLED_ERROR',
    message: error.message,
    request_id: requestId,
  });

  void reply.status(statusCode).send(toErrorBody(error, requestId));
}
