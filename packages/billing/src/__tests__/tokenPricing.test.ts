import { describe, expect, it } from 'vitest';

import { priceTokens } from '../usage/tokenPricing';

describe('separate token rates', () => {
  const price = { completionPerK: 2n, promptPerK: 1n };
  it('charges input and output at their own prices, not the maximum rate', () => {
    expect(priceTokens(1000, 1000, price)).toBe(3n);
    expect(priceTokens(1000, 0, price)).toBe(1n);
    expect(priceTokens(0, 1000, price)).toBe(2n);
  });
  it('rounds combined fractional credits once and preserves explicit free models', () => {
    expect(priceTokens(100, 100, price)).toBe(1n);
    expect(priceTokens(10, 10, { completionPerK: 0n, promptPerK: 0n })).toBe(0n);
    expect(priceTokens(0, 0, price)).toBe(0n);
  });
  it('rejects missing, negative or nonfinite usage instead of silently undercharging', () => {
    for (const invalid of [-1, 0.5, NaN, Infinity]) expect(() => priceTokens(invalid, 0, price)).toThrow();
  });
});
