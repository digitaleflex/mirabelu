import { describe, expect, it } from 'vitest';
import { addMonths, PLANS } from '../src/index.js';

describe('plans', () => {
  it('tarifs', () => {
    expect(PLANS.QUARTERLY.priceXof).toBe(7500);
    expect(PLANS.ANNUAL.priceXof).toBe(25000);
  });
  it('addMonths ne déborde pas en fin de mois', () => {
    expect(addMonths(new Date('2026-01-31T10:00:00Z'), 1).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addMonths(new Date('2028-01-31T10:00:00Z'), 1).toISOString()).toBe('2028-02-29T10:00:00.000Z');
    expect(addMonths(new Date('2026-11-30T00:00:00Z'), 3).toISOString()).toBe('2027-02-28T00:00:00.000Z');
    expect(addMonths(new Date('2026-11-11T00:00:00Z'), 12).toISOString()).toBe('2027-11-11T00:00:00.000Z');
  });
});
