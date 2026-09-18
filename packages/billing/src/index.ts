/**
 * @lobechat/billing — provider-neutral commercial billing domain logic
 *
 * Public API surface:
 *
 *  Types
 *    ChargeMode, HoldCommand/Result, SettleCommand/Result,
 *    ReleaseCommand/Result, CreditCommand/Result,
 *    NormalizedUsage, PriceSnapshot, UsagePriceSnapshot, CreditUnits, …
 *
 *  Policy
 *    resolveChargeMode(ctx)     — decides platform / byok / gateway_fee
 *    requiresPlatformCharge(ctx)
 *
 *  Commands
 *    BillingCommandService      — hold / settle / release / credit
 *    PriceSnapshotService       — freeze price snapshots
 *
 *  Usage
 *    UsageNormalizer            — normalize + compute credits from raw usage
 *
 *  Idempotency
 *    buildIdempotencyKey(…)     — deterministic idempotency key builder
 *    buildSettleKeys(…)
 *    validateRequestId(…)
 */

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  BillingUnitType,
  ChargeMode,
  CreditCommand,
  CreditResult,
  CreditUnits,
  CurrencyCode,
  HoldCommand,
  HoldResult,
  MinorAmount,
  NormalizedUsage,
  PriceSnapshot,
  ReleaseCommand,
  ReleaseResult,
  SettleCommand,
  SettleResult,
  UsagePriceSnapshot,
} from './types';

// ── Policy ────────────────────────────────────────────────────────────────────
export type { BillingContext, ChargeModeDecision } from './policy';
export { requiresPlatformCharge, resolveChargeMode } from './policy';

// ── Commands ──────────────────────────────────────────────────────────────────
export { BillingCommandService } from './commands';
export { PriceSnapshotNotFoundError, PriceSnapshotService } from './commands';

// ── Usage ─────────────────────────────────────────────────────────────────────
export type { RawProviderUsage } from './usage';
export { UsageNormalizer } from './usage';

// ── Idempotency ───────────────────────────────────────────────────────────────
export type { IdempotencyKeySuffix } from './idempotency';
export { buildIdempotencyKey, buildSettleKeys, validateRequestId } from './idempotency';
