/**
 * Billing command and result types.
 *
 * Commands are plain data structures (no side-effects) that an application-layer
 * middleware assembles from model-runtime usage and passes to BillingCommandService.
 * This keeps runtime/provider SDKs fully decoupled from the billing package.
 */
import type { CreditUnits, UsagePriceSnapshot } from './money';

// ─── charge mode ─────────────────────────────────────────────────────────────

/**
 * How the current request should be billed.
 *
 * - `platform`:   deduct platform credits (hold → settle / release flow)
 * - `byok`:       user supplies their own API key; no platform credit deducted
 * - `gateway_fee`: BYOK with an optional small platform gateway surcharge
 */
export type ChargeMode = 'platform' | 'byok' | 'gateway_fee';

// ─── hold command ─────────────────────────────────────────────────────────────

/**
 * Command issued before calling the model provider.
 * Reserves `estimatedCredits` so the wallet cannot go negative mid-flight.
 */
export interface HoldCommand {
  billingAccountId: string;
  /** Upper-bound estimate in credit units. */
  estimatedCredits: CreditUnits;
  /** Price snapshot frozen at hold time. */
  priceSnapshot: UsagePriceSnapshot;
  /** Human-readable reason stored in the ledger entry. */
  reason: string;
  requestId: string;
}

export interface HoldResult {
  /** Wallet available balance after hold (informational). */
  availableAfter: CreditUnits;
  holdIdempotencyKey: string;
  /** Ledger entry ID for this hold; carry it forward to settle/release. */
  ledgerEntryId: string;
}

// ─── settle command ───────────────────────────────────────────────────────────

/**
 * Command issued after the model provider returns final usage.
 * Converts the hold into an actual debit and releases any over-estimate.
 */
export interface SettleCommand {
  /** Credits actually consumed (may be ≤ estimatedCredits). */
  actualCredits: CreditUnits;
  billingAccountId: string;
  /** ID returned from HoldResult; used as the reverse-lookup key. */
  holdLedgerEntryId: string;
  requestId: string;
  /** Final token counts from the provider response. */
  usage: NormalizedUsage;
}

export interface SettleResult {
  /** Net credits charged. */
  creditsCharged: CreditUnits;
  debitLedgerEntryId: string;
  releaseLedgerEntryId: string | null;
}

// ─── release command ──────────────────────────────────────────────────────────

/**
 * Command issued on provider error, timeout, or stream interruption.
 * Returns all reserved credits to available.
 */
export interface ReleaseCommand {
  billingAccountId: string;
  /** Credits to release (must match original hold amount). */
  heldCredits: CreditUnits;
  holdLedgerEntryId: string;
  reason: string;
  requestId: string;
}

export interface ReleaseResult {
  releaseLedgerEntryId: string;
}

// ─── credit command ───────────────────────────────────────────────────────────

/**
 * Command for topping up a wallet (e.g. after a paid order is confirmed).
 * Called by the Webhook handler, not by the model-call middleware.
 */
export interface CreditCommand {
  billingAccountId: string;
  /** Amount in credit units to add to available balance. */
  credits: CreditUnits;
  idempotencyKey: string;
  /** Admin user ID for manual adjustments. */
  operatorUserId?: string;
  /**
   * Paid top-up order id. Omit for admin/signup grants — `ledger_entries.order_id`
   * has a real FK to `orders.id`, so a synthetic id would abort the insert.
   */
  orderId?: string;
  reason?: string;
}

export interface CreditResult {
  availableAfter: CreditUnits;
  ledgerEntryId: string;
}

// ─── normalized usage ─────────────────────────────────────────────────────────

/**
 * Normalized usage data produced by the application middleware after a model
 * call completes.  The billing package only consumes this; it never calls the
 * provider SDK directly.
 */
export interface NormalizedUsage {
  completionTokens: number;
  /** Wall-clock ms for the full round-trip (informational). */
  durationMs?: number;
  modelId: string;
  promptTokens: number;
  provider: string;
  requestId: string;
  totalTokens: number;
}
