import type { FastifyPluginAsync } from 'fastify';
import type { BusSearchController } from '../controllers/bus-search.controller.js';

export function createBusRoutes(controller: BusSearchController): FastifyPluginAsync {
  return async (app) => {
    app.post('/api/v1/buses/search', async (request, reply) => {
      await controller.search(request, reply);
    });
  };
}
