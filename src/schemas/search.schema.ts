import { z } from 'zod';
import { isPastDate, parseDateOnly } from '../utils/time.js';

const hhmm = z
  .string()
  .trim()
  .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM (24h)');

const ymd = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

/**
 * FE input: source, destination, date, time
 * (also accepts from_city / to_city / travel_date / preferred_time)
 */
export const busSearchBodySchema = z
  .object({
    source: z.string().trim().min(1).optional(),
    destination: z.string().trim().min(1).optional(),
    date: ymd.optional(),
    time: hhmm.optional(),

    from_city: z.string().trim().min(1).optional(),
    to_city: z.string().trim().min(1).optional(),
    travel_date: ymd.optional(),
    preferred_time: hhmm.optional(),
  })
  .superRefine((data, ctx) => {
    const from = data.source || data.from_city;
    const to = data.destination || data.to_city;
    const travelDate = data.date || data.travel_date;
    const preferred = data.time || data.preferred_time;

    if (!from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'source (or from_city) is required',
        path: ['source'],
      });
    }
    if (!to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'destination (or to_city) is required',
        path: ['destination'],
      });
    }
    if (!travelDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'date (or travel_date) is required as YYYY-MM-DD',
        path: ['date'],
      });
    }
    if (!preferred) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'time (or preferred_time) is required as HH:MM',
        path: ['time'],
      });
    }

    if (from && to && from.toLowerCase() === to.toLowerCase()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'source and destination cannot be the same',
        path: ['destination'],
      });
    }

    if (travelDate) {
      try {
        parseDateOnly(travelDate);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'date must be a valid calendar date',
          path: ['date'],
        });
        return;
      }
      if (isPastDate(travelDate)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'date cannot be in the past',
          path: ['date'],
        });
      }
    }
  })
  .transform((data) => ({
    from_city: (data.source || data.from_city)!,
    to_city: (data.destination || data.to_city)!,
    travel_date: (data.date || data.travel_date)!,
    preferred_time: (data.time || data.preferred_time)!,
  }));

export type BusSearchBody = z.infer<typeof busSearchBodySchema>;
