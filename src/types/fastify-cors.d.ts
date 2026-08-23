declare module '@fastify/cors' {
  import type { FastifyPluginCallback } from 'fastify';

  export type OriginCallback = (err: Error | null, allow?: boolean) => void;
  export type OriginFunction = (origin: string | undefined, cb: OriginCallback) => void;

  export interface FastifyCorsOptions {
    origin?: string | string[] | boolean | RegExp | OriginFunction;
    methods?: string | string[];
    allowedHeaders?: string | string[];
    credentials?: boolean;
    exposedHeaders?: string | string[];
    maxAge?: number;
    preflight?: boolean;
    strictPreflight?: boolean;
  }

  const fastifyCors: FastifyPluginCallback<FastifyCorsOptions>;
  export default fastifyCors;
}
