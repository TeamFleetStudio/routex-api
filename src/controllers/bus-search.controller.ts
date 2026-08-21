import type { FastifyReply, FastifyRequest } from 'fastify';
import { busSearchBodySchema } from '../schemas/search.schema.js';
import { ValidationError } from '../errors/index.js';
import type { SearchService } from '../services/search/search.service.js';

export class BusSearchController {
  constructor(private readonly searchService: SearchService) {}

  async search(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const parsed = busSearchBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join('; ');
      throw new ValidationError(message);
    }

    const result = await this.searchService.search(parsed.data, request.requestId);
    const statusCode = result.status === 'SEARCH_FAILED' ? 502 : 200;
    await reply.status(statusCode).send(result);
  }
}
