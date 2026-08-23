import type { CanonicalBus } from '../types/bus.types.js';

export interface PaginationParams {
  cursor?: string;
  limit?: number;
}

export interface PaginationMeta {
  limit: number;
  total_items: number;
  has_more: boolean;
  next_cursor: string | null;
}

export interface PaginatedSlice<T> {
  data: T[];
  pagination: PaginationMeta;
}

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 50;

interface CursorPayload {
  offset: number;
}

export function resolvePageLimit(limit?: number): number {
  if (limit === undefined) return DEFAULT_PAGE_LIMIT;
  return Math.min(Math.max(1, limit), MAX_PAGE_LIMIT);
}

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor?.trim()) return 0;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as CursorPayload;
    return typeof parsed.offset === 'number' && parsed.offset >= 0 ? parsed.offset : 0;
  } catch {
    return 0;
  }
}

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

export function paginateResults(
  results: CanonicalBus[],
  params: PaginationParams,
): PaginatedSlice<CanonicalBus> {
  const limit = resolvePageLimit(params.limit);
  const offset = decodeCursor(params.cursor);
  const data = results.slice(offset, offset + limit);
  const nextOffset = offset + data.length;
  const hasMore = nextOffset < results.length;

  return {
    data,
    pagination: {
      limit,
      total_items: results.length,
      has_more: hasMore,
      next_cursor: hasMore ? encodeCursor(nextOffset) : null,
    },
  };
}
