import { GenericApiSourceClient } from '../generic/generic-api-source.client.js';

export class AbhiBusSourceClient extends GenericApiSourceClient {
  constructor(baseUrl: string, apiKey: string, timeoutMs: number) {
    super({ sourceName: 'abhibus', baseUrl, apiKey, timeoutMs });
  }
}
