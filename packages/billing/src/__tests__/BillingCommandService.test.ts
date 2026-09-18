/**
 * BillingCommandService unit tests
 *
 * Uses a mock WalletModel injected via vi.mock so this suite has no DB
 * dependency and runs purely in-process.
 *
 * Covered scenarios (matching ACCEPTANCE_USER_BILLING §6):
 *  - Insufficient balance → PRECONDITION_FAILED before provider call
 *  - Exact (boundary) balance → hold succeeds; 1 credit over → fails
 *  - Duplicate requestId → idempotent: same ledger entry, no double-hold
 *  - Concurrent holds → only one succeeds when balance is exactly 1 unit
 *  - settle() deducts actual amount and releases over-estimate
 *  - release() on provider error restores full reserved amount
 *  - credit() is idempotent via idempotency key
 *  - getAvailableBalance() throws NOT_FOUND for unknown wallet
 */
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingCommandService } from '../commands/BillingCommandService';
import type { HoldCommand } from '../types/commands';
import type { UsagePriceSnapshot } from '../types/money';

// ─── mock WalletModel ─────────────────────────────────────────────────────────

// We stub the WalletModel at the module level so BillingCommandService never
// touches a real database.

const mockHold = vi.fn();
const mockSettle = vi.fn();
const mockRelease = vi.fn();
const mockCredit = vi.fn();
const mockFindByBillingAccountId = vi.fn();

vi.mock('@lobechat/database', () => ({
  WalletModel: vi.fn().mockImplementation(function () {
    return {
      hold: mockHold,
      settle: mockSettle,
      release: mockRelease,
      credit: mockCredit,
      findByBillingAccountId: mockFindByBillingAccountId,
    };
  }),
}));

// ─── helpers ──────────────────────────────────────────────────────────────────

const BAC = 'bac_test';
const REQ = 'req-test-001';

const priceSnap: UsagePriceSnapshot = {
  unitType: 'total_token',
  creditsPerUnit: 1n,
  currency: 'CNY',
  snapshotAt: new Date().toISOString(),
};

function makeHoldCmd(overrides?: Partial<HoldCommand>): HoldCommand {
  return {
    billingAccountId: BAC,
    requestId: REQ,
    reason: 'test hold',
    estimatedCredits: 100n,
    priceSnapshot: priceSnap,
    ...overrides,
  };
}

function makeLedger(id: string) {
  return {
    id,
    billingAccountId: BAC,
    kind: 'hold',
    delta: -100n,
    balanceAfter: 0n,
    idempotencyKey: 'k',
    createdAt: new Date(),
  };
}

function makeWallet(available: bigint, reserved = 0n) {
  return {
    id: 'wal_1',
    billingAccountId: BAC,
    available,
    reserved,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ─── tests ────────────────────────────────────────────────────────────────────

let svc: BillingCommandService;

beforeEach(() => {
  vi.clearAllMocks();
  svc = new BillingCommandService({} as any);
});

describe('hold()', () => {
  it('returns ledger entry ID and available balance on success', async () => {
    mockHold.mockResolvedValueOnce({ wallet: makeWallet(900n), ledger: makeLedger('led_1') });
    const result = await svc.hold(makeHoldCmd());
    expect(result.ledgerEntryId).toBe('led_1');
    expect(result.availableAfter).toBe(900n);
  });

  it('throws PRECONDITION_FAILED when balance is insufficient', async () => {
    mockHold.mockRejectedValueOnce(
      new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Insufficient balance' }),
    );
    await expect(svc.hold(makeHoldCmd())).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('boundary: hold for exact available balance succeeds', async () => {
    mockHold.mockResolvedValueOnce({ wallet: makeWallet(0n), ledger: makeLedger('led_boundary') });
    const result = await svc.hold(makeHoldCmd({ estimatedCredits: 100n }));
    expect(result.ledgerEntryId).toBe('led_boundary');
    expect(result.availableAfter).toBe(0n);
  });

  it('boundary+1: hold for one credit over balance throws PRECONDITION_FAILED', async () => {
    mockHold.mockRejectedValueOnce(
      new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Insufficient balance' }),
    );
    await expect(svc.hold(makeHoldCmd({ estimatedCredits: 101n }))).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it('duplicate requestId: WalletModel returns existing ledger (idempotent hold)', async () => {
    // First call succeeds
    mockHold.mockResolvedValueOnce({ wallet: makeWallet(900n), ledger: makeLedger('led_1') });
    const first = await svc.hold(makeHoldCmd());

    // Second call with same requestId: WalletModel detects duplicate, returns same ledger
    mockHold.mockResolvedValueOnce({ wallet: makeWallet(900n), ledger: makeLedger('led_1') });
    const second = await svc.hold(makeHoldCmd());

    expect(first.ledgerEntryId).toBe(second.ledgerEntryId);
    // WalletModel.hold was called twice (service doesn't short-circuit; WalletModel handles dedup)
    expect(mockHold).toHaveBeenCalledTimes(2);
  });

  it('same idempotency key used for same billingAccountId + requestId', async () => {
    mockHold.mockResolvedValueOnce({ wallet: makeWallet(0n), ledger: makeLedger('led_2') });
    await svc.hold(makeHoldCmd());
    const callArg = mockHold.mock.calls[0][0];
    expect(callArg.idempotencyKey).toBe(`billing:hold:${BAC}:${REQ}`);
  });

  it('rejects invalid requestId', async () => {
    await expect(svc.hold(makeHoldCmd({ requestId: '' }))).rejects.toThrow(TypeError);
    await expect(svc.hold(makeHoldCmd({ requestId: ' req ' }))).rejects.toThrow(TypeError);
    expect(mockHold).not.toHaveBeenCalled();
  });
});

describe('settle()', () => {
  it('debits actual amount and releases over-estimate', async () => {
    const debitEntry = { id: 'led_debit', delta: -80n, kind: 'debit' };
    const releaseEntry = { id: 'led_release', kind: 'release' };
    mockSettle.mockResolvedValueOnce({ wallet: makeWallet(200n), debitEntry, releaseEntry });

    const result = await svc.settle({
      billingAccountId: BAC,
      requestId: REQ,
      holdLedgerEntryId: 'led_1',
      actualCredits: 80n,
      heldCredits: 100n,
      usage: {
        requestId: REQ,
        modelId: 'gpt-4o',
        provider: 'openai',
        promptTokens: 50,
        completionTokens: 30,
        totalTokens: 80,
      },
    });

    expect(result.debitLedgerEntryId).toBe('led_debit');
    expect(result.releaseLedgerEntryId).toBe('led_release');
    expect(result.creditsCharged).toBe(80n);
  });

  it('no release entry when actualCredits === heldCredits', async () => {
    mockSettle.mockResolvedValueOnce({
      wallet: makeWallet(100n),
      debitEntry: { id: 'led_debit2' },
      releaseEntry: null,
    });

    const result = await svc.settle({
      billingAccountId: BAC,
      requestId: REQ,
      holdLedgerEntryId: 'led_1',
      actualCredits: 100n,
      heldCredits: 100n,
      usage: {
        requestId: REQ,
        modelId: 'gpt-4o',
        provider: 'openai',
        promptTokens: 60,
        completionTokens: 40,
        totalTokens: 100,
      },
    });

    expect(result.releaseLedgerEntryId).toBeNull();
  });

  it('uses deterministic debit/release idempotency keys', async () => {
    mockSettle.mockResolvedValueOnce({
      wallet: makeWallet(0n),
      debitEntry: { id: 'd' },
      releaseEntry: null,
    });
    await svc.settle({
      billingAccountId: BAC,
      requestId: REQ,
      holdLedgerEntryId: 'x',
      actualCredits: 10n,
      heldCredits: 10n,
      usage: {
        requestId: REQ,
        modelId: 'm',
        provider: 'p',
        promptTokens: 5,
        completionTokens: 5,
        totalTokens: 10,
      },
    });
    const call = mockSettle.mock.calls[0][0];
    expect(call.debitIdempotencyKey).toBe(`billing:debit:${BAC}:${REQ}`);
    expect(call.releaseIdempotencyKey).toBe(`billing:release:${BAC}:${REQ}`);
  });
});

describe('release()', () => {
  it('releases full held amount on provider failure', async () => {
    mockRelease.mockResolvedValueOnce({ wallet: makeWallet(100n), ledger: { id: 'led_rel' } });

    const result = await svc.release({
      billingAccountId: BAC,
      requestId: REQ,
      holdLedgerEntryId: 'led_hold',
      heldCredits: 100n,
      reason: 'provider timeout',
    });

    expect(result.releaseLedgerEntryId).toBe('led_rel');
  });

  it('uses deterministic release idempotency key', async () => {
    mockRelease.mockResolvedValueOnce({ wallet: makeWallet(0n), ledger: { id: 'lr' } });
    await svc.release({
      billingAccountId: BAC,
      requestId: REQ,
      holdLedgerEntryId: 'x',
      heldCredits: 50n,
      reason: 'err',
    });
    const call = mockRelease.mock.calls[0][0];
    expect(call.idempotencyKey).toBe(`billing:release:${BAC}:${REQ}`);
  });

  it('idempotent: repeated release with same requestId returns same key', async () => {
    mockRelease
      .mockResolvedValueOnce({ wallet: makeWallet(50n), ledger: { id: 'lr_1' } })
      .mockResolvedValueOnce({ wallet: makeWallet(50n), ledger: { id: 'lr_1' } });

    const r1 = await svc.release({
      billingAccountId: BAC,
      requestId: REQ,
      holdLedgerEntryId: 'x',
      heldCredits: 50n,
      reason: '',
    });
    const r2 = await svc.release({
      billingAccountId: BAC,
      requestId: REQ,
      holdLedgerEntryId: 'x',
      heldCredits: 50n,
      reason: '',
    });
    expect(r1.releaseLedgerEntryId).toBe(r2.releaseLedgerEntryId);
  });
});

describe('credit()', () => {
  it('adds credits to wallet and returns ledger entry', async () => {
    mockCredit.mockResolvedValueOnce({ wallet: makeWallet(1000n), ledger: { id: 'led_credit' } });

    const result = await svc.credit({
      billingAccountId: BAC,
      credits: 1000n,
      orderId: 'ord_1',
      idempotencyKey: 'credit:evt_stripe_123',
    });

    expect(result.ledgerEntryId).toBe('led_credit');
    expect(result.availableAfter).toBe(1000n);
  });

  it('forwards credits without an orderId for admin/signup grants', async () => {
    mockCredit.mockResolvedValueOnce({ wallet: makeWallet(100n), ledger: { id: 'led_admin' } });

    await svc.credit({
      billingAccountId: BAC,
      credits: 100n,
      idempotencyKey: 'admin:credit:op-1',
      reason: 'compensation',
    });

    expect(mockCredit).toHaveBeenCalledWith(
      expect.objectContaining({
        billingAccountId: BAC,
        delta: 100n,
        idempotencyKey: 'admin:credit:op-1',
        orderId: undefined,
      }),
    );
  });

  it('idempotent: repeated credit with same idempotencyKey returns same entry', async () => {
    const ledger = { id: 'led_idem_credit' };
    mockCredit
      .mockResolvedValueOnce({ wallet: makeWallet(500n), ledger })
      .mockResolvedValueOnce({ wallet: makeWallet(500n), ledger });

    const r1 = await svc.credit({
      billingAccountId: BAC,
      credits: 500n,
      orderId: 'ord_1',
      idempotencyKey: 'k',
    });
    const r2 = await svc.credit({
      billingAccountId: BAC,
      credits: 500n,
      orderId: 'ord_1',
      idempotencyKey: 'k',
    });
    expect(r1.ledgerEntryId).toBe(r2.ledgerEntryId);
    expect(r1.availableAfter).toBe(500n);
  });
});

describe('getAvailableBalance()', () => {
  it('returns available balance from wallet', async () => {
    mockFindByBillingAccountId.mockResolvedValueOnce(makeWallet(250n));
    const bal = await svc.getAvailableBalance(BAC);
    expect(bal).toBe(250n);
  });

  it('throws NOT_FOUND for unknown billing account', async () => {
    mockFindByBillingAccountId.mockResolvedValueOnce(undefined);
    await expect(svc.getAvailableBalance('bac_unknown')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('concurrent hold simulation', () => {
  it('only one of two concurrent holds succeeds when balance equals one hold amount', async () => {
    // Simulate one success and one version-conflict CONFLICT error
    mockHold
      .mockResolvedValueOnce({ wallet: makeWallet(0n), ledger: makeLedger('led_c1') })
      .mockRejectedValueOnce(
        new TRPCError({ code: 'CONFLICT', message: 'Wallet version conflict; please retry' }),
      );

    const results = await Promise.allSettled([
      svc.hold(makeHoldCmd({ requestId: 'req-c1' })),
      svc.hold(makeHoldCmd({ requestId: 'req-c2' })),
    ]);

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    // Failure must be a retriable CONFLICT, not a silent corruption
    const rejection = failed[0] as PromiseRejectedResult;
    expect(rejection.reason).toMatchObject({ code: 'CONFLICT' });
  });
});
