import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors/index.js';
import type { SearchService } from '../services/search/search.service.js';

export class SearchEventsController {
  constructor(private readonly searchService: SearchService) {}

  async streamEvents(
    request: FastifyRequest<{ Params: { searchId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const searchId = request.params.searchId;
    const session = await this.searchService.getSearchStatus(searchId, request.requestId);
    if (!session) {
      throw new AppError('Search session not found', { code: 'NOT_FOUND', statusCode: 404 });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const writeEvent = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    writeEvent('connected', { ...session });

    const unsubscribers = [
      this.searchService.onProviderCompleted(searchId, (data) => {
        writeEvent('provider_completed', data);
      }),
      this.searchService.onSessionUpdated(searchId, (data) => {
        writeEvent('session_updated', data);
      }),
      this.searchService.onSearchFinished(searchId, (data) => {
        writeEvent('search_finished', data);
        reply.raw.end();
      }),
    ];

    request.raw.on('close', () => {
      for (const unsub of unsubscribers) unsub();
    });

    if (!session.updating_more_results) {
      writeEvent('search_finished', { status: session.status ?? 'SUCCESS' });
      reply.raw.end();
    }
  }
}
