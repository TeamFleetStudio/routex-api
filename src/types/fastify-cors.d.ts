declare module '@fastify/cors' {
  import type { FastifyPluginCallback } from 'fastify';

  export interface FastifyCorsOptions {
    origin?: string | string[] | boolean | RegExp;
    methods?: string | string[];
    allowedHeaders?: string | string[];
    credentials?: boolean;
    exposedHeaders?: string | string[];
    maxAge?: number;
  }

  const fastifyCors: FastifyPluginCallback<FastifyCorsOptions>;
  export default fastifyCors;
}
