import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors/index.js';
import type { SearchService } from '../services/search/search.service.js';

const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

export class SearchPaginationController {
  constructor(private readonly searchService: SearchService) {}

  async getPage(
    request: FastifyRequest<{ Params: { searchId: string }; Querystring: { cursor?: string; limit?: string } }>,
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

    const result = await this.searchService.getSessionPage(
      request.params.searchId,
      request.requestId,
      parsed.data.cursor,
      parsed.data.limit,
    );

    if (!result) {
      throw new AppError('Search session not found', { code: 'NOT_FOUND', statusCode: 404 });
    }

    const statusCode = result.status === 'SEARCH_FAILED' ? 502 : 200;
    await reply.status(statusCode).send(result);
  }
}
