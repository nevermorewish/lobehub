/**
 * BillingCommandService — the central command executor for all balance-affecting
 * billing operations.
 *
 * Design principles:
 *  - All balance mutations run inside a single DB transaction.
 *  - Every mutation produces an immutable ledger entry.
 *  - Idempotency is checked FIRST; duplicate keys return the existing result.
 *  - The wallet uses an optimistic-lock version counter to prevent concurrent
 *    overdrafts.  The `FOR UPDATE` row lock in `WalletModel` provides the
 *    serialization guarantee within a transaction.
 *  - Failures are always safe to release/reverse; no "half-charged" states.
 *
 * Transaction boundary contract
 * ─────────────────────────────
 *  hold()   → ledger(hold) + wallet.available↓ + wallet.reserved↑
 *  settle() → ledger(debit) + ledger(release?) + wallet.reserved↓ + wallet.available↑(over-est.)
 *  release()→ ledger(release) + wallet.reserved↓ + wallet.available↑
 *  credit() → ledger(credit) + wallet.available↑
 *
 * Failure modes
 * ─────────────
 *  - Insufficient balance:  TRPCError PRECONDITION_FAILED  (caller should show charge prompt)
 *  - Duplicate idempotency: returns existing result silently
 *  - Version conflict:       TRPCError CONFLICT             (caller should retry)
 *  - Not found:              TRPCError NOT_FOUND
 */
import type { LobeChatDatabase } from '@lobechat/database';
import { WalletModel } from '@lobechat/database';
import { TRPCError } from '@trpc/server';

import { buildIdempotencyKey, buildSettleKeys, validateRequestId } from '../idempotency/keys';
import type {
  CreditCommand,
  CreditResult,
  HoldCommand,
  HoldResult,
  ReleaseCommand,
  ReleaseResult,
  SettleCommand,
  SettleResult,
} from '../types/commands';

// ─────────────────────────────────────────────────────────────────────────────

export class BillingCommandService {
  private readonly walletModel: WalletModel;

  constructor(private readonly db: LobeChatDatabase) {
    this.walletModel = new WalletModel(db);
  }

  // ─── hold ───────────────────────────────────────────────────────────────────

  /**
   * Reserves `estimatedCredits` from the wallet BEFORE the provider is called.
   *
   * Idempotent: if a hold for the same requestId already exists for this
   * billing account, the existing result is returned without double-reserving.
   *
   * @throws TRPCError(PRECONDITION_FAILED) if the wallet balance is insufficient.
   * @throws TRPCError(NOT_FOUND) if no wallet exists for the billing account.
   */
  async hold(cmd: HoldCommand): Promise<HoldResult> {
    validateRequestId(cmd.requestId);

    const ikey = buildIdempotencyKey('hold', cmd.billingAccountId, cmd.requestId);

    const { wallet, ledger } = await this.walletModel.hold({
      billingAccountId: cmd.billingAccountId,
      amount: cmd.estimatedCredits,
      idempotencyKey: ikey,
      reason: cmd.reason,
    });

    return {
      ledgerEntryId: ledger.id,
      holdIdempotencyKey: ikey,
      availableAfter: wallet.available,
    };
  }

  // ─── settle ─────────────────────────────────────────────────────────────────

  /**
   * Converts a hold into a final debit after the model call completes.
   *
   * `actualCredits` may be ≤ `cmd.heldCredits` — the difference is released.
   *
   * Idempotent: if debit for the same requestId already exists, returns the
   * existing result.
   */
  async settle(cmd: SettleCommand & { heldCredits: bigint }): Promise<SettleResult> {
    validateRequestId(cmd.requestId);

    const { debitKey, releaseKey } = buildSettleKeys(cmd.billingAccountId, cmd.requestId);

    const { debitEntry, releaseEntry } = await this.walletModel.settle({
      billingAccountId: cmd.billingAccountId,
      heldAmount: cmd.heldCredits,
      holdLedgerEntryId: cmd.holdLedgerEntryId,
      actualAmount: cmd.actualCredits,
      debitIdempotencyKey: debitKey,
      releaseIdempotencyKey: releaseKey,
      usageRecordId: undefined,
      reason: `settle:${cmd.requestId}`,
    });

    return {
      debitLedgerEntryId: debitEntry.id,
      releaseLedgerEntryId: releaseEntry?.id ?? null,
      creditsCharged: -debitEntry.delta,
    };
  }

  // ─── release ────────────────────────────────────────────────────────────────

  /**
   * Releases a hold entirely when the provider call fails, times out, or the
   * stream is interrupted.  Net credit impact = 0.
   *
   * Idempotent: safe to call multiple times for the same requestId.
   */
  async release(cmd: ReleaseCommand): Promise<ReleaseResult> {
    validateRequestId(cmd.requestId);

    const ikey = buildIdempotencyKey('release', cmd.billingAccountId, cmd.requestId);

    const { ledger } = await this.walletModel.release({
      billingAccountId: cmd.billingAccountId,
      amount: cmd.heldCredits,
      holdLedgerEntryId: cmd.holdLedgerEntryId,
      idempotencyKey: ikey,
      reason: cmd.reason,
    });

    return { releaseLedgerEntryId: ledger.id };
  }

  // ─── credit ─────────────────────────────────────────────────────────────────

  /**
   * Credits the wallet with `cmd.credits` units.  Typically called by the
   * Webhook handler after a payment is confirmed.
   *
   * Idempotent via `cmd.idempotencyKey` (caller must generate a stable key from
   * the provider event ID, e.g. `credit:${stripeEventId}`).
   */
  async credit(cmd: CreditCommand): Promise<CreditResult> {
    const { wallet, ledger } = await this.walletModel.credit({
      billingAccountId: cmd.billingAccountId,
      delta: cmd.credits,
      idempotencyKey: cmd.idempotencyKey,
      orderId: cmd.orderId,
      reason: cmd.reason,
      operatorUserId: cmd.operatorUserId,
    });

    return {
      ledgerEntryId: ledger.id,
      availableAfter: wallet.available,
    };
  }

  // ─── balance check ──────────────────────────────────────────────────────────

  /**
   * Returns the current available balance for the billing account.
   * Use this to gate requests BEFORE issuing a hold.
   *
   * NOTE: the returned value is informational — a hold may still fail due to
   * a concurrent deduction between this read and the hold write.  Always let
   * `hold()` be the authoritative gate.
   */
  async getAvailableBalance(billingAccountId: string): Promise<bigint> {
    const wallet = await this.walletModel.findByBillingAccountId(billingAccountId);
    if (!wallet) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Wallet not found' });
    }
    return wallet.available;
  }
}
