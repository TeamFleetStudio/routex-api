import { GenericApiSourceClient } from '../generic/generic-api-source.client.js';

export class RedBusSourceClient extends GenericApiSourceClient {
  constructor(baseUrl: string, apiKey: string, timeoutMs: number) {
    super({ sourceName: 'redbus', baseUrl, apiKey, timeoutMs });
  }
}
