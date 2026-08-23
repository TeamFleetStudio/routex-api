import type { FastifyReply, FastifyRequest } from 'fastify';
import { busSearchBodySchema } from '../schemas/search.schema.js';
import { ValidationError } from '../errors/index.js';
import type { SearchService } from '../services/search/search.service.js';

export class BusSearchController {
  constructor(private readonly searchService: SearchService) {}

  async search(
    request: FastifyRequest<{ Querystring: { wait?: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const parsed = busSearchBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join('; ');
      throw new ValidationError(message);
    }

    const waitAll = request.query.wait === 'all';

    const result = await this.searchService.search(parsed.data, request.requestId, {
      includeAll: parsed.data.include_all,
      waitAll,
    });
    // Always 200 — failure is in body (`status` / `success`). HTTP 502 here was
    // confused with EasyPanel/Traefik gateway timeouts on long progressive scrapes.
    await reply.status(200).send(result);
  }
}
