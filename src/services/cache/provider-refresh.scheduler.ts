import { logger } from '../../utils/logger.js';

type RefreshTask = () => Promise<void>;

export class ProviderRefreshScheduler {
  private readonly inFlight = new Set<string>();

  schedule(key: string, task: RefreshTask): void {
    if (this.inFlight.has(key)) return;
    this.inFlight.add(key);
    logger.info({ event: 'PROVIDER_REFRESH_SCHEDULED', key });

    void task()
      .catch((err) => {
        logger.error({
          event: 'PROVIDER_REFRESH_FAILED',
          key,
          message: err instanceof Error ? err.message : 'unknown',
        });
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
  }

  isRefreshing(key: string): boolean {
    return this.inFlight.has(key);
  }
}
