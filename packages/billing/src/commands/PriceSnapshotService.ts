/**
 * PriceSnapshotService — reads a plan_price row and freezes it as an immutable
 * snapshot that is stored alongside every order and usage record.
 *
 * Key invariant: after `freezeSnapshot` returns, the caller uses ONLY the
 * returned `UsagePriceSnapshot` / `PriceSnapshot` for all downstream writes.
 * The server never trusts client-supplied amounts.
 */
import type { LobeChatDatabase } from '@lobechat/database';
import { planPrices, plans } from '@lobechat/database/schemas';
import { eq } from 'drizzle-orm';

import type { PriceSnapshot, UsagePriceSnapshot } from '../types/money';

// ─────────────────────────────────────────────────────────────────────────────

export class PriceSnapshotNotFoundError extends Error {
  constructor(planPriceId: string) {
    super(`PlanPrice "${planPriceId}" not found or archived`);
    this.name = 'PriceSnapshotNotFoundError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export class PriceSnapshotService {
  constructor(private readonly db: LobeChatDatabase) {}

  /**
   * Reads the `plan_price` row identified by `planPriceId` and returns an
   * immutable `PriceSnapshot`.
   *
   * Throws `PriceSnapshotNotFoundError` if the row doesn't exist or is archived.
   *
   * IMPORTANT: call this on every order creation / request start so that a
   * price change after the call has no effect on in-flight requests.
   */
  async freezeSnapshot(planPriceId: string): Promise<PriceSnapshot> {
    const [row] = await this.db
      .select({
        id: planPrices.id,
        planId: planPrices.planId,
        currency: planPrices.currency,
        amountMinor: planPrices.amountMinor,
        billingInterval: planPrices.billingInterval,
        archivedAt: planPrices.archivedAt,
        tokenGrantMonthly: plans.tokenGrantMonthly,
        planStatus: plans.status,
      })
      .from(planPrices)
      .innerJoin(plans, eq(planPrices.planId, plans.id))
      .where(eq(planPrices.id, planPriceId))
      .limit(1)
      .for('share');

    if (!row || row.archivedAt !== null || row.planStatus !== 'active') {
      throw new PriceSnapshotNotFoundError(planPriceId);
    }

    return {
      planPriceId: row.id,
      planId: row.planId,
      currency: row.currency,
      amountMinor: row.amountMinor,
      billingInterval: row.billingInterval as PriceSnapshot['billingInterval'],
      // Orders retain this grant even after administrators publish a new price.
      creditGrant: row.tokenGrantMonthly ?? BigInt(0),
      snapshotAt: new Date(),
    };
  }

  /**
   * Builds a `UsagePriceSnapshot` for per-token billing.
   *
   * `creditsPerThousandTokens` comes from the admin-configured model price table
   * (not yet implemented as its own DB table — supplied by the caller for now).
   * Stored as integer credits: `creditsPerUnit = creditsPerThousandTokens / 1000`
   * is intentionally kept as a bigint denominator to avoid floating point.
   *
   * Callers should store `creditsPerThousandTokens` and do integer arithmetic:
   *   totalCredits = (totalTokens * creditsPerThousandTokens) / 1000n
   */
  static buildUsagePriceSnapshot(params: {
    unitType: UsagePriceSnapshot['unitType'];
    /** Credits charged per 1 000 tokens (integer).  E.g. 1 credit / 1k tokens = 1. */
    creditsPerThousandTokens: bigint;
    currency: string;
  }): UsagePriceSnapshot {
    return {
      unitType: params.unitType,
      /**
       * Store the per-thousand rate as the credits-per-unit field; callers
       * must use `computeCredits()` below, which divides correctly.
       */
      creditsPerUnit: params.creditsPerThousandTokens,
      currency: params.currency,
      snapshotAt: new Date().toISOString(),
    };
  }

  /**
   * Computes total credits from a token count and a snapshot.
   *
   * Assumes `snapshot.creditsPerUnit` is "credits per 1 000 tokens".
   * Uses integer bigint division (truncation) — intentionally conservative.
   */
  static computeCredits(tokens: number, snapshot: UsagePriceSnapshot): bigint {
    return (BigInt(tokens) * snapshot.creditsPerUnit) / 1000n;
  }
}
