import { describe, expect, it } from 'vitest';

import type { BillingContext } from '../policy/BillingPolicy';
import { requiresPlatformCharge, resolveChargeMode } from '../policy/BillingPolicy';

const base: BillingContext = {
  provider: 'openai',
  userHasProviderKey: false,
  isPlatformManagedProvider: false,
  byokAllowed: true,
  gatewayFeeEnabled: false,
};

describe('resolveChargeMode', () => {
  it('platform-managed provider → platform, regardless of user key', () => {
    const d = resolveChargeMode({ ...base, isPlatformManagedProvider: true, userHasProviderKey: true });
    expect(d.chargeMode).toBe('platform');
  });

  it('byok disabled globally → platform even if user has key', () => {
    const d = resolveChargeMode({ ...base, byokAllowed: false, userHasProviderKey: true });
    expect(d.chargeMode).toBe('platform');
  });

  it('user has key + byok allowed + no gateway fee → byok', () => {
    const d = resolveChargeMode({ ...base, userHasProviderKey: true });
    expect(d.chargeMode).toBe('byok');
  });

  it('user has key + byok allowed + gateway fee → gateway_fee', () => {
    const d = resolveChargeMode({ ...base, userHasProviderKey: true, gatewayFeeEnabled: true });
    expect(d.chargeMode).toBe('gateway_fee');
  });

  it('no user key → platform', () => {
    const d = resolveChargeMode({ ...base, userHasProviderKey: false });
    expect(d.chargeMode).toBe('platform');
  });

  it('returns a non-empty reason string in all branches', () => {
    const cases: BillingContext[] = [
      { ...base, isPlatformManagedProvider: true },
      { ...base, byokAllowed: false },
      { ...base, userHasProviderKey: true },
      { ...base, userHasProviderKey: true, gatewayFeeEnabled: true },
      { ...base },
    ];
    for (const ctx of cases) {
      expect(resolveChargeMode(ctx).reason.length).toBeGreaterThan(0);
    }
  });
});

describe('requiresPlatformCharge', () => {
  it('returns true for platform mode', () => {
    expect(requiresPlatformCharge({ ...base })).toBe(true);
  });

  it('returns true for gateway_fee mode', () => {
    expect(requiresPlatformCharge({ ...base, userHasProviderKey: true, gatewayFeeEnabled: true })).toBe(true);
  });

  it('returns false for byok mode', () => {
    expect(requiresPlatformCharge({ ...base, userHasProviderKey: true })).toBe(false);
  });
});
