import type { FastifyPluginAsync } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
    searchId?: string;
  }
}

export const requestContextPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (request, reply) => {
    const requestId = request.id;
    request.requestId = requestId;
    reply.header('x-request-id', requestId);

    request.log = request.log.child({ request_id: requestId });
    request.log.info({ event: 'REQUEST_STARTED', method: request.method, url: request.url });
  });

  app.addHook('onResponse', async (request, reply) => {
    request.log.info({
      event: 'REQUEST_COMPLETED',
      method: request.method,
      url: request.url,
      status_code: reply.statusCode,
      duration_ms: reply.elapsedTime,
    });
  });
};
