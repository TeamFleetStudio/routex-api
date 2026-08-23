import { z } from 'zod';
import { isPastDate, parseDateOnly } from '../utils/time.js';

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const rawBusSearchBodySchema = z.object({
  from_city: z.string().trim().min(1, 'from_city is required'),
  to_city: z.string().trim().min(1, 'to_city is required'),
  travel_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'travel_date must be YYYY-MM-DD'),
  depart_after: z
    .string()
    .trim()
    .optional()
    .refine((v) => v === undefined || v === '' || timePattern.test(v), {
      message: 'depart_after must be HH:MM or empty',
    }),
  time: z
    .string()
    .trim()
    .optional()
    .refine((v) => v === undefined || v === '' || timePattern.test(v), {
      message: 'time must be HH:MM or empty',
    }),
  limit: z.coerce.number().int().positive().max(50).optional(),
  include_all: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

export const busSearchBodySchema = rawBusSearchBodySchema
  .transform((data) => ({
    from_city: data.from_city,
    to_city: data.to_city,
    travel_date: data.travel_date,
    depart_after: (data.depart_after ?? data.time ?? '').trim(),
    limit: data.limit,
    include_all: data.include_all ?? false,
  }))
  .superRefine((data, ctx) => {
    if (data.from_city.toLowerCase() === data.to_city.toLowerCase()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'from_city and to_city cannot be the same',
        path: ['to_city'],
      });
    }

    try {
      parseDateOnly(data.travel_date);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'travel_date must be a valid calendar date',
        path: ['travel_date'],
      });
      return;
    }

    if (isPastDate(data.travel_date)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'travel_date cannot be in the past',
        path: ['travel_date'],
      });
    }
  });

export type BusSearchBody = z.infer<typeof busSearchBodySchema>;
