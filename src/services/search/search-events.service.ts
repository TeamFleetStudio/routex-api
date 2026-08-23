import { EventEmitter } from 'node:events';

export interface ProviderCompletedEvent {
  provider: string;
  bus_count: number;
  total_buses: number;
}

export interface SessionUpdatedEvent {
  total_buses: number;
  progress_percent: number;
}

export interface SearchFinishedEvent {
  status: string;
}

type SearchEventMap = {
  provider_completed: ProviderCompletedEvent;
  session_updated: SessionUpdatedEvent;
  search_finished: SearchFinishedEvent;
};

export class SearchEventsService {
  private readonly emitters = new Map<string, EventEmitter>();

  subscribe<K extends keyof SearchEventMap>(
    searchId: string,
    event: K,
    listener: (data: SearchEventMap[K]) => void,
  ): () => void {
    const emitter = this.getOrCreateEmitter(searchId);
    emitter.on(event, listener);
    return () => {
      emitter.off(event, listener);
      if (emitter.listenerCount('provider_completed') === 0 &&
          emitter.listenerCount('session_updated') === 0 &&
          emitter.listenerCount('search_finished') === 0) {
        this.emitters.delete(searchId);
      }
    };
  }

  emitProviderCompleted(searchId: string, data: ProviderCompletedEvent): void {
    this.getOrCreateEmitter(searchId).emit('provider_completed', data);
  }

  emitSessionUpdated(searchId: string, data: SessionUpdatedEvent): void {
    this.getOrCreateEmitter(searchId).emit('session_updated', data);
  }

  emitSearchFinished(searchId: string, data: SearchFinishedEvent): void {
    this.getOrCreateEmitter(searchId).emit('search_finished', data);
    this.emitters.delete(searchId);
  }

  private getOrCreateEmitter(searchId: string): EventEmitter {
    let emitter = this.emitters.get(searchId);
    if (!emitter) {
      emitter = new EventEmitter();
      emitter.setMaxListeners(50);
      this.emitters.set(searchId, emitter);
    }
    return emitter;
  }
}
