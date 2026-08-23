import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors/index.js';
import type { SearchService } from '../services/search/search.service.js';

export class SearchStatusController {
  constructor(private readonly searchService: SearchService) {}

  async getStatus(
    request: FastifyRequest<{ Params: { searchId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const status = await this.searchService.getSearchStatus(
      request.params.searchId,
      request.requestId,
    );

    if (!status) {
      throw new AppError('Search session not found', { code: 'NOT_FOUND', statusCode: 404 });
    }

    await reply.status(200).send(status);
  }
}
