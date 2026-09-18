import { describe, expect, it } from 'vitest';

import type { UsagePriceSnapshot } from '../types/money';
import { UsageNormalizer } from '../usage/UsageNormalizer';

const snapshot = (unitType: UsagePriceSnapshot['unitType'], cpt: bigint): UsagePriceSnapshot => ({
  unitType,
  creditsPerUnit: cpt,
  currency: 'CNY',
  snapshotAt: new Date().toISOString(),
});

describe('UsageNormalizer.normalize', () => {
  it('normalizes all token fields', () => {
    const u = UsageNormalizer.normalize({
      requestId: 'req-001',
      modelId: 'gpt-4o',
      provider: 'openai',
      raw: { promptTokens: 100, completionTokens: 50 },
    });
    expect(u.promptTokens).toBe(100);
    expect(u.completionTokens).toBe(50);
    expect(u.totalTokens).toBe(150);
  });

  it('defaults missing token counts to 0 (no phantom charges)', () => {
    const u = UsageNormalizer.normalize({
      requestId: 'req-002',
      modelId: 'gpt-4o',
      provider: 'openai',
      raw: {},
    });
    expect(u.promptTokens).toBe(0);
    expect(u.completionTokens).toBe(0);
    expect(u.totalTokens).toBe(0);
  });

  it('uses provider-supplied total when present', () => {
    const u = UsageNormalizer.normalize({
      requestId: 'req-003',
      modelId: 'claude-3',
      provider: 'anthropic',
      raw: { promptTokens: 100, completionTokens: 50, totalTokens: 155 },
    });
    expect(u.totalTokens).toBe(155);
  });

  it('rejects invalid requestId', () => {
    expect(() =>
      UsageNormalizer.normalize({ requestId: '  ', modelId: 'm', provider: 'p', raw: {} }),
    ).toThrow();
    expect(() =>
      UsageNormalizer.normalize({ requestId: '', modelId: 'm', provider: 'p', raw: {} }),
    ).toThrow();
  });

  it('floors fractional token counts', () => {
    const u = UsageNormalizer.normalize({
      requestId: 'req-004',
      modelId: 'gpt-4o',
      provider: 'openai',
      raw: { promptTokens: 100.9, completionTokens: 49.1 },
    });
    expect(u.promptTokens).toBe(100);
    expect(u.completionTokens).toBe(49);
  });
});

describe('UsageNormalizer.computeCredits', () => {
  const usage = {
    requestId: 'req-x',
    modelId: 'gpt-4o',
    provider: 'openai',
    promptTokens: 1000,
    completionTokens: 500,
    totalTokens: 1500,
  };

  it('prompt_token: 1000 tokens × 1 credit/1k = 1 credit', () => {
    expect(UsageNormalizer.computeCredits(usage, snapshot('prompt_token', 1n))).toBe(1n);
  });

  it('completion_token: 500 tokens × 2 credits/1k = 1 credit (integer div)', () => {
    expect(UsageNormalizer.computeCredits(usage, snapshot('completion_token', 2n))).toBe(1n);
  });

  it('total_token: 1500 tokens × 1 credit/1k = 1 credit (truncation)', () => {
    expect(UsageNormalizer.computeCredits(usage, snapshot('total_token', 1n))).toBe(1n);
  });

  it('request: flat per-request charge', () => {
    expect(UsageNormalizer.computeCredits(usage, snapshot('request', 5n))).toBe(5n);
  });

  it('zero tokens yields zero credits', () => {
    const empty = { ...usage, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    expect(UsageNormalizer.computeCredits(empty, snapshot('total_token', 100n))).toBe(0n);
  });
});

describe('UsageNormalizer.estimateCredits', () => {
  it('estimates upper-bound from prompt + max completion tokens', () => {
    const snap = snapshot('total_token', 1n);
    // (100 + 900) * 1 / 1000 = 1
    const est = UsageNormalizer.estimateCredits(
      { promptTokens: 100, maxCompletionTokens: 900 },
      snap,
    );
    expect(est).toBe(1n);
  });
});
