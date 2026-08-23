import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors/index.js';
import type { SearchService } from '../services/search/search.service.js';
import type { SearchFilterOptions } from '../services/search/search-filter.service.js';

const busTypeTags = ['AC', 'NON_AC', 'SLEEPER', 'SEMI_SLEEPER', 'SEATER', 'VOLVO', 'MULTI_AXLE', 'ELECTRIC'] as const;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
  sort: z.enum(['best_value', 'cheapest', 'fastest', 'earliest', 'latest']).optional(),
  min_price: z.coerce.number().nonnegative().optional(),
  max_price: z.coerce.number().nonnegative().optional(),
  depart_after: z
    .string()
    .optional()
    .refine((v) => v === undefined || timePattern.test(v), { message: 'depart_after must be HH:MM' }),
  depart_before: z
    .string()
    .optional()
    .refine((v) => v === undefined || timePattern.test(v), { message: 'depart_before must be HH:MM' }),
  bus_type: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((t) => t.trim().toUpperCase())
            .filter((t): t is (typeof busTypeTags)[number] =>
              (busTypeTags as readonly string[]).includes(t),
            )
        : undefined,
    ),
  min_platforms: z.coerce.number().int().positive().optional(),
  operator: z.string().trim().optional(),
});

export class SearchPaginationController {
  constructor(private readonly searchService: SearchService) {}

  async getPage(
    request: FastifyRequest<{
      Params: { searchId: string };
      Querystring: Record<string, string | undefined>;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const parsed = paginationQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join('; ');
      await reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message },
        request_id: request.requestId,
      });
      return;
    }

    const filterOptions: SearchFilterOptions = {
      sort: parsed.data.sort,
      min_price: parsed.data.min_price,
      max_price: parsed.data.max_price,
      depart_after: parsed.data.depart_after,
      depart_before: parsed.data.depart_before,
      bus_type: parsed.data.bus_type,
      min_platforms: parsed.data.min_platforms,
      operator: parsed.data.operator,
    };

    const result = await this.searchService.getSessionPage(
      request.params.searchId,
      request.requestId,
      parsed.data.cursor,
      parsed.data.limit,
      filterOptions,
    );

    if (!result) {
      throw new AppError('Search session not found', { code: 'NOT_FOUND', statusCode: 404 });
    }

    await reply.status(200).send(result);
  }
}
