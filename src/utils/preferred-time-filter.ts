import type { NormalizedBusListing } from '../types/bus.types.js';
import { minuteDiffAbs, parseTimeToMinutes } from './time.js';

/** Default: keep buses whose departure is within ±N minutes of preferred_time. */
export const DEFAULT_PREFERRED_TIME_WINDOW_MINUTES = 30;

export function filterByPreferredTime<T extends Pick<NormalizedBusListing, 'departure_time'>>(
  listings: T[],
  preferredTime: string | null | undefined,
  windowMinutes: number = DEFAULT_PREFERRED_TIME_WINDOW_MINUTES,
): T[] {
  if (!preferredTime) return listings;
  const preferredMins = parseTimeToMinutes(preferredTime);
  if (preferredMins == null) return listings;

  return listings.filter((listing) => {
    const dep = parseTimeToMinutes(listing.departure_time);
    if (dep == null) return false;
    return minuteDiffAbs(dep, preferredMins) <= windowMinutes;
  });
}
