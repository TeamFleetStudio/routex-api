import { GenericApiSourceClient } from '../generic/generic-api-source.client.js';

export class MMTSourceClient extends GenericApiSourceClient {
  constructor(baseUrl: string, apiKey: string, timeoutMs: number) {
    super({ sourceName: 'makemytrip', baseUrl, apiKey, timeoutMs });
  }
}
