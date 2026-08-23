import type { SearchSession } from '../../types/search-session.types.js';

/** True while providers are still running — not when data was served from stale cache. */
export function isSearchUpdating(session: SearchSession): boolean {
  const progress = session.provider_progress;
  if (progress && Object.keys(progress).length > 0) {
    const entries = Object.values(progress);
    if (entries.some((p) => p.status === 'processing')) return true;
    const total = session.total_providers ?? entries.length;
    const done = entries.filter((p) => p.status !== 'processing').length;
    return done < total;
  }

  const total = session.total_providers ?? session.sources.length;
  return session.sources.length < total;
}
