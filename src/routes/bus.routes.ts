import type { FastifyPluginAsync } from 'fastify';
import type { BusSearchController } from '../controllers/bus-search.controller.js';
import type { SearchPaginationController } from '../controllers/search-pagination.controller.js';
import type { SearchStatusController } from '../controllers/search-status.controller.js';
import type { SearchEventsController } from '../controllers/search-events.controller.js';
import type { AnalyticsController } from '../controllers/analytics.controller.js';

export function createBusRoutes(
  controller: BusSearchController,
  paginationController: SearchPaginationController,
  statusController: SearchStatusController,
  eventsController: SearchEventsController,
  analyticsController: AnalyticsController,
): FastifyPluginAsync {
  return async (app) => {
    app.post('/api/v1/buses/search', async (request, reply) => {
      await controller.search(
        request as Parameters<BusSearchController['search']>[0],
        reply,
      );
    });

    app.get('/api/v1/searches/:searchId/buses', async (request, reply) => {
      await paginationController.getPage(
        request as Parameters<SearchPaginationController['getPage']>[0],
        reply,
      );
    });

    app.get('/api/v1/searches/:searchId/status', async (request, reply) => {
      await statusController.getStatus(
        request as Parameters<SearchStatusController['getStatus']>[0],
        reply,
      );
    });

    app.get('/api/v1/searches/:searchId/events', async (request, reply) => {
      await eventsController.streamEvents(
        request as Parameters<SearchEventsController['streamEvents']>[0],
        reply,
      );
    });

    app.get('/api/v1/analytics/providers', async (request, reply) => {
      await analyticsController.getProviderAnalytics(request, reply);
    });
  };
}
