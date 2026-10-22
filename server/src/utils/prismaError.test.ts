import { describe, expect, it } from 'vitest';
import { mapPrismaError } from './prismaError';

describe('mapPrismaError', () => {
  it('maps invalid enum values to a schema-out-of-date error', () => {
    const err = new Error(
      'invalid input value for enum "ScanType": "TIMED_BURST"',
    );
    err.name = 'PrismaClientUnknownRequestError';

    const mapped = mapPrismaError(err);
    expect(mapped?.code).toBe('DATABASE_UNAVAILABLE');
    expect(mapped?.statusCode).toBe(503);
    expect(mapped?.message).toMatch(/schema is out of date/i);
  });
});
