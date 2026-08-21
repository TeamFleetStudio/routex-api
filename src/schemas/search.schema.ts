import { z } from 'zod';
import { isPastDate, parseDateOnly } from '../utils/time.js';

export const busSearchBodySchema = z
  .object({
    from_city: z.string().trim().min(1, 'from_city is required'),
    to_city: z.string().trim().min(1, 'to_city is required'),
    travel_date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'travel_date must be YYYY-MM-DD'),
  })
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
