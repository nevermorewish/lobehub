import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';

import type { LedgerEntry, Wallet } from '../schemas/billing';
import { billingAccounts, ledgerEntries, wallets } from '../schemas/billing';
import type { LobeChatDatabase } from '../type';

type Transaction = Parameters<Parameters<LobeChatDatabase['transaction']>[0]>[0];

interface Mutation {
  billingAccountId: string;
  idempotencyKey: string;
  reason?: string;
}

/** All mutations serialize on the wallet before checking idempotency. */
export class WalletModel {
  constructor(private readonly db: LobeChatDatabase) {}

  async findByBillingAccountId(billingAccountId: string) {
    const [wallet] = await this.db
      .select()
      .from(wallets)
      .where(eq(wallets.billingAccountId, billingAccountId));
    return wallet;
  }

  private async lock(tx: Transaction, billingAccountId: string) {
    const [wallet] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.billingAccountId, billingAccountId))
      .for('update');
    if (!wallet) throw new TRPCError({ code: 'NOT_FOUND', message: 'Wallet not found' });
    return wallet;
  }

  private async existing(tx: Transaction, params: Mutation) {
    const [entry] = await tx
      .select()
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.billingAccountId, params.billingAccountId),
          eq(ledgerEntries.idempotencyKey, params.idempotencyKey),
        ),
      );
    return entry;
  }

  private async apply(
    tx: Transaction,
    wallet: Wallet,
    entry: Omit<typeof ledgerEntries.$inferInsert, 'balanceAfter' | 'billingAccountId'>,
  ) {
    const available = wallet.available + entry.availableDelta;
    const reserved = wallet.reserved + entry.reservedDelta;
    if (available < 0n || reserved < 0n) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Insufficient balance' });
    }
    const [updated] = await tx
      .update(wallets)
      .set({ available, reserved, version: wallet.version + 1 })
      .where(eq(wallets.id, wallet.id))
      .returning();
    const [ledger] = await tx
      .insert(ledgerEntries)
      .values({
        ...entry,
        balanceAfter: available,
        billingAccountId: wallet.billingAccountId,
      })
      .returning();
    return { ledger, wallet: updated };
  }

  async credit(params: Mutation & { delta: bigint; operatorUserId?: string; orderId?: string }) {
    if (params.delta <= 0n)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Credits must be positive' });
    return this.db.transaction(async (tx) => {
      const wallet = await this.lock(tx, params.billingAccountId);
      const existing = await this.existing(tx, params);
      if (existing) {
        if (
          existing.kind !== 'credit' ||
          existing.delta !== params.delta ||
          existing.orderId !== (params.orderId ?? null)
        ) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Idempotency key has different credit parameters',
          });
        }
        return { ledger: existing, wallet };
      }
      return this.apply(tx, wallet, {
        availableDelta: params.delta,
        delta: params.delta,
        idempotencyKey: params.idempotencyKey,
        kind: 'credit',
        operatorUserId: params.operatorUserId,
        orderId: params.orderId,
        reason: params.reason,
        reservedDelta: 0n,
      });
    });
  }

  async hold(params: Mutation & { amount: bigint; usageRecordId?: string }) {
    if (params.amount < 0n)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Hold must be nonnegative' });
    return this.db.transaction(async (tx) => {
      const wallet = await this.lock(tx, params.billingAccountId);
      const [account] = await tx
        .select()
        .from(billingAccounts)
        .where(eq(billingAccounts.id, params.billingAccountId));
      if (account.status !== 'active')
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Billing account is suspended' });
      const existing = await this.existing(tx, params);
      if (existing) {
        if (existing.kind !== 'hold' || existing.reservedDelta !== params.amount) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Idempotency key has different hold parameters',
          });
        }
        const [terminal] = await tx
          .select()
          .from(ledgerEntries)
          .where(eq(ledgerEntries.holdId, existing.id));
        if (terminal)
          throw new TRPCError({ code: 'CONFLICT', message: 'Request was already completed' });
        return { ledger: existing, wallet };
      }
      return this.apply(tx, wallet, {
        availableDelta: -params.amount,
        delta: 0n,
        idempotencyKey: params.idempotencyKey,
        kind: 'hold',
        reason: params.reason,
        reservedDelta: params.amount,
        usageRecordId: params.usageRecordId,
      });
    });
  }

  private async requireHold(
    tx: Transaction,
    billingAccountId: string,
    holdLedgerEntryId: string,
    heldAmount: bigint,
  ) {
    const [hold] = await tx
      .select()
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.id, holdLedgerEntryId),
          eq(ledgerEntries.billingAccountId, billingAccountId),
          eq(ledgerEntries.kind, 'hold'),
        ),
      );
    if (!hold || hold.reservedDelta !== heldAmount) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Hold does not match this settlement',
      });
    }
    const [terminal] = await tx
      .select()
      .from(ledgerEntries)
      .where(
        and(eq(ledgerEntries.holdId, hold.id), inArray(ledgerEntries.kind, ['debit', 'release'])),
      );
    return { hold, terminal };
  }

  async settle(params: {
    actualAmount: bigint;
    billingAccountId: string;
    debitIdempotencyKey: string;
    heldAmount: bigint;
    holdLedgerEntryId: string;
    reason?: string;
    releaseIdempotencyKey: string;
    usageRecordId?: string;
  }): Promise<{ wallet: Wallet; debitEntry: LedgerEntry; releaseEntry: LedgerEntry | null }> {
    if (params.actualAmount < 0n)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Charge must be nonnegative' });
    return this.db.transaction(async (tx) => {
      const wallet = await this.lock(tx, params.billingAccountId);
      const { hold, terminal } = await this.requireHold(
        tx,
        params.billingAccountId,
        params.holdLedgerEntryId,
        params.heldAmount,
      );
      if (terminal) {
        if (terminal.kind !== 'debit' || terminal.delta !== -params.actualAmount) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Hold has already been finalized differently',
          });
        }
        return { debitEntry: terminal, releaseEntry: null, wallet };
      }
      const result = await this.apply(tx, wallet, {
        availableDelta: params.heldAmount - params.actualAmount,
        delta: -params.actualAmount,
        holdId: hold.id,
        idempotencyKey: params.debitIdempotencyKey,
        kind: 'debit',
        reason: params.reason,
        reservedDelta: -params.heldAmount,
        usageRecordId: params.usageRecordId,
      });
      return { debitEntry: result.ledger, releaseEntry: null, wallet: result.wallet };
    });
  }

  async release(
    params: Mutation & { amount: bigint; holdLedgerEntryId: string; usageRecordId?: string },
  ) {
    return this.db.transaction(async (tx) => {
      const wallet = await this.lock(tx, params.billingAccountId);
      const { hold, terminal } = await this.requireHold(
        tx,
        params.billingAccountId,
        params.holdLedgerEntryId,
        params.amount,
      );
      // Error/timeout cleanup after a completed charge must never refund it a second time.
      if (terminal) return { ledger: terminal, wallet };
      return this.apply(tx, wallet, {
        availableDelta: params.amount,
        delta: 0n,
        holdId: hold.id,
        idempotencyKey: params.idempotencyKey,
        kind: 'release',
        reason: params.reason,
        reservedDelta: -params.amount,
        usageRecordId: params.usageRecordId,
      });
    });
  }
}
