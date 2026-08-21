export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function daysUntil(travelDate: string, now = new Date()): number {
  const travel = parseDateOnly(travelDate);
  const today = startOfDay(now);
  const diffMs = travel.getTime() - today.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

export function parseDateOnly(dateStr: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) {
    throw new Error(`Invalid date: ${dateStr}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    throw new Error(`Invalid calendar date: ${dateStr}`);
  }
  return d;
}

export function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function isPastDate(travelDate: string, now = new Date()): boolean {
  return daysUntil(travelDate, now) < 0;
}

export function addMs(isoOrDate: string | Date, ms: number): string {
  const base = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  return new Date(base.getTime() + ms).toISOString();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Parse common time strings like "9:30 PM", "10.30 pm", or "21:30" into 24h HH:mm. */
export function normalizeTimeTo24h(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();

  const h24 = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (h24) {
    const h = Number(h24[1]);
    const m = Number(h24[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }

  const ampmColon = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(raw);
  if (ampmColon) {
    return to24h(Number(ampmColon[1]), Number(ampmColon[2]), ampmColon[3]);
  }

  const ampmDot = /^(\d{1,2})\.(\d{2})\s*(AM|PM)$/i.exec(raw);
  if (ampmDot) {
    return to24h(Number(ampmDot[1]), Number(ampmDot[2]), ampmDot[3]);
  }

  return null;
}

function to24h(h: number, m: number, period: string): string | null {
  if (h < 1 || h > 12 || m < 0 || m > 59) return null;
  let hour = h;
  const p = period.toUpperCase();
  if (p === 'AM') {
    if (hour === 12) hour = 0;
  } else if (hour !== 12) {
    hour += 12;
  }
  return `${String(hour).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function timeToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function parsePriceInr(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') return null;
  // Handles "₹1,250", "Starting from ₹999", "850.00"
  const cleaned = value.replace(/,/g, '').replace(/[^\d.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Extract INR amount from Bright Data price objects or scalars. */
export function extractPriceValue(value: unknown): number | null {
  if (value && typeof value === 'object' && 'value' in value) {
    return parsePriceInr((value as { value: unknown }).value);
  }
  return parsePriceInr(value);
}

/**
 * Parse durations like "6h 50m", "06h.45m", "9 hours", "08:30" (as duration) into minutes.
 */
export function parseDurationMinutes(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value !== 'string' || !value.trim()) return null;

  const raw = value.trim().toLowerCase();

  const asClock = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (asClock) {
    const h = Number(asClock[1]);
    const m = Number(asClock[2]);
    if (h >= 0 && m >= 0 && m <= 59) return h * 60 + m;
  }

  const hoursWord = /(\d+)\s*hours?/.exec(raw);
  const normalized = raw.replace(/\./g, ' ');
  const hours = /(\d+)\s*h/.exec(normalized) ?? hoursWord;
  const mins = /(\d+)\s*m/.exec(normalized);
  if (!hours && !mins) return null;
  const h = hours ? Number(hours[1]) : 0;
  const m = mins ? Number(mins[1]) : 0;
  return h * 60 + m;
}

/** Parse "23 Seats" → 23; non-numeric availability text → null. */
export function parseSeatsAvailable(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const match = /(\d+)/.exec(value);
  return match ? Number(match[1]) : null;
}

export function cleanOperatorName(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.replace(/\nAD\s*$/i, '').trim() || null;
}
