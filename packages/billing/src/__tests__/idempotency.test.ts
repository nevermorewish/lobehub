import { describe, expect, it } from 'vitest';

import { buildIdempotencyKey, buildSettleKeys, validateRequestId } from '../idempotency/keys';

describe('buildIdempotencyKey', () => {
  it('keeps long scoped identifiers within the ledger limit without truncation collisions', () => {
    const account = 'a'.repeat(128);
    const key = buildIdempotencyKey('hold', account, 'b'.repeat(128));
    expect(key.length).toBeLessThanOrEqual(128);
    expect(key).not.toBe(buildIdempotencyKey('hold', account, 'b'.repeat(127) + 'c'));
  });
  it('produces a deterministic key', () => {
    const k1 = buildIdempotencyKey('hold', 'bac_abc', 'req_xyz');
    const k2 = buildIdempotencyKey('hold', 'bac_abc', 'req_xyz');
    expect(k1).toBe(k2);
    expect(k1).toBe('billing:hold:bac_abc:req_xyz');
  });

  it('different suffixes produce different keys', () => {
    const h = buildIdempotencyKey('hold', 'bac_1', 'req_1');
    const d = buildIdempotencyKey('debit', 'bac_1', 'req_1');
    expect(h).not.toBe(d);
  });
});

describe('buildSettleKeys', () => {
  it('returns different debit and release keys', () => {
    const { debitKey, releaseKey } = buildSettleKeys('bac_1', 'req_1');
    expect(debitKey).not.toBe(releaseKey);
    expect(debitKey).toContain('debit');
    expect(releaseKey).toContain('release');
  });
});

describe('validateRequestId', () => {
  it('accepts valid IDs', () => {
    expect(() => validateRequestId('req-001')).not.toThrow();
    expect(() => validateRequestId('a'.repeat(128))).not.toThrow();
  });

  it('rejects empty string', () => {
    expect(() => validateRequestId('')).toThrow(TypeError);
  });

  it('rejects strings with leading/trailing whitespace', () => {
    expect(() => validateRequestId(' req')).toThrow(TypeError);
    expect(() => validateRequestId('req ')).toThrow(TypeError);
  });

  it('rejects strings with internal whitespace or control chars', () => {
    expect(() => validateRequestId('req 001')).toThrow(TypeError);
    expect(() => validateRequestId('req\t001')).toThrow(TypeError);
    expect(() => validateRequestId('req\n001')).toThrow(TypeError);
  });

  it('rejects strings longer than 128 chars', () => {
    expect(() => validateRequestId('a'.repeat(129))).toThrow(TypeError);
  });
});
