import type { FastifyPluginAsync } from 'fastify';
import type { BusSearchController } from '../controllers/bus-search.controller.js';
import type { SearchPaginationController } from '../controllers/search-pagination.controller.js';

export function createBusRoutes(
  controller: BusSearchController,
  paginationController: SearchPaginationController,
): FastifyPluginAsync {
  return async (app) => {
    app.post('/api/v1/buses/search', async (request, reply) => {
      await controller.search(request, reply);
    });

    app.get('/api/v1/searches/:searchId/buses', async (request, reply) => {
      await paginationController.getPage(
        request as Parameters<SearchPaginationController['getPage']>[0],
        reply,
      );
    });
  };
}
