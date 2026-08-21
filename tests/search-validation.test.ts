import { describe, expect, it } from 'vitest';
import { busSearchBodySchema } from '../src/schemas/search.schema.js';

describe('bus search validation', () => {
  it('accepts a valid search body', () => {
    const result = busSearchBodySchema.safeParse({
      from_city: 'Chennai',
      to_city: 'Bengaluru',
      travel_date: '2099-08-25',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing cities', () => {
    const result = busSearchBodySchema.safeParse({
      from_city: '',
      to_city: 'Bengaluru',
      travel_date: '2099-08-25',
    });
    expect(result.success).toBe(false);
  });

  it('rejects same origin and destination', () => {
    const result = busSearchBodySchema.safeParse({
      from_city: 'Chennai',
      to_city: 'chennai',
      travel_date: '2099-08-25',
    });
    expect(result.success).toBe(false);
  });

  it('rejects past travel dates', () => {
    const result = busSearchBodySchema.safeParse({
      from_city: 'Chennai',
      to_city: 'Bengaluru',
      travel_date: '2020-01-01',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid calendar dates', () => {
    const result = busSearchBodySchema.safeParse({
      from_city: 'Chennai',
      to_city: 'Bengaluru',
      travel_date: '2099-02-30',
    });
    expect(result.success).toBe(false);
  });
});
