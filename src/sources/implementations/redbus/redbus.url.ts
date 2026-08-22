import type { BusSearchRequest } from '../../../types/bus.types.js';

const MONTHS = [
  'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec',
] as const;

const CITY_ALIASES: Record<string, string> = {
  bangalore: 'bangalore',
  bengaluru: 'bangalore',
  mumbai: 'mumbai',
  bombay: 'mumbai',
  delhi: 'delhi',
  'new delhi': 'delhi',
  chennai: 'chennai',
  madras: 'chennai',
};

function slugifyCity(name: string): string {
  const key = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const aliased = CITY_ALIASES[key] || key;
  return aliased
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/** Build redBus search URL from RouteX search params (dynamic route). */
export function buildRedBusSearchUrl(search: BusSearchRequest): string {
  const from = slugifyCity(search.from_city);
  const to = slugifyCity(search.to_city);
  const [y, m, d] = search.travel_date.split('-').map(Number);
  const dd = String(d).padStart(2, '0');
  const mon = MONTHS[m - 1];
  const ddMmmYyyy = `${dd}-${mon}-${y}`;
  return `https://www.redbus.in/bus-tickets/${from}-to-${to}?onward=${ddMmmYyyy}&doj=${ddMmmYyyy}`;
}

/** Extract redBus busId from a URL or numeric string. */
export function extractRedBusBusId(...candidates: Array<string | null | undefined>): string | null {
  for (const raw of candidates) {
    if (raw == null) continue;
    const s = String(raw).trim();
    if (!s) continue;
    if (/^\d+$/.test(s)) return s;
    try {
      const u = new URL(s);
      const busId = u.searchParams.get('busId');
      if (busId && /^\d+$/.test(busId)) return busId;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Build a per-bus redBus deep link for the FE.
 * Always uses the correct search route path (from/to/date), then attaches busId
 * (and optional city ids) from Bright Data product_page_url when present.
 *
 * Bright Data often returns product_page_url with a stale path (e.g. chennai-to-bangalore)
 * even when the scrape was madurai-to-chennai — we rewrite the path from searchUrl.
 */
export function resolveRedBusListingUrl(opts: {
  searchUrl: string;
  productPageUrl?: string | null;
  listingUrl?: string | null;
  url?: string | null;
}): { listing_url: string | null; source_listing_id: string | null } {
  const busIdFromProduct = extractRedBusBusId(opts.productPageUrl, opts.url);
  // listing_url from BD is often a shared search session id, not busId — only use if no product busId
  const busId = busIdFromProduct ?? extractRedBusBusId(opts.listingUrl);

  if (opts.searchUrl && busId) {
    try {
      const base = new URL(opts.searchUrl);
      if (opts.productPageUrl && /^https?:\/\//i.test(opts.productPageUrl)) {
        try {
          const prod = new URL(opts.productPageUrl);
          for (const key of ['fromCityId', 'fromCityName', 'toCityId', 'toCityName'] as const) {
            const v = prod.searchParams.get(key);
            if (v) base.searchParams.set(key, v);
          }
        } catch {
          /* ignore */
        }
      }
      base.searchParams.set('busId', busId);
      return { listing_url: base.toString(), source_listing_id: busId };
    } catch {
      /* fall through */
    }
  }

  for (const cand of [opts.productPageUrl, opts.listingUrl, opts.url]) {
    if (typeof cand === 'string' && /^https?:\/\//i.test(cand)) {
      return {
        listing_url: cand,
        source_listing_id: extractRedBusBusId(cand),
      };
    }
  }

  return { listing_url: null, source_listing_id: busId };
}
