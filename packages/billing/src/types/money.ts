/**
 * Money and credit unit types.
 *
 * Rule: ALL monetary amounts are represented as `bigint` integer minor-currency
 * units (e.g. fen for CNY, cent for USD).  Platform credits are integer units
 * (dimensionless).  No `number` or `float` is used for authoritative amounts.
 */

/** ISO 4217 currency code, e.g. "CNY", "USD". */
export type CurrencyCode = string;

/**
 * An amount in integer minor-currency units.
 * Use this opaque alias to distinguish money from raw bigints.
 */
export type MinorAmount = bigint;

/**
 * Platform credit units (dimensionless integer, e.g. "积分").
 * 1 credit ≠ 1 currency minor unit; conversion is plan-defined.
 */
export type CreditUnits = bigint;

/** A snapshot of a price at a specific point in time. */
export interface PriceSnapshot {
  /** Amount in integer minor-currency units. */
  amountMinor: MinorAmount;
  billingInterval: 'one_time' | 'monthly' | 'yearly';
  /**
   * Credit units the customer receives per purchase.
   * Present for top-up / credit-grant orders; absent for pure subscription.
   */
  creditGrant?: CreditUnits;
  currency: CurrencyCode;
  planId: string;
  /** FK to plan_prices row — immutable after creation. */
  planPriceId: string;
  /** Wall-clock time this snapshot was read and frozen. */
  snapshotAt: Date;
}

/**
 * The unit type used when pricing per usage.
 * Keeps per-token and per-request billing paths distinct.
 */
export type BillingUnitType = 'prompt_token' | 'completion_token' | 'total_token' | 'request';

/** Per-unit price in credit units. Stored alongside a usage record. */
export interface UsagePriceSnapshot {
  /** Credits charged per unit (integer, e.g. 1 credit per 1 000 tokens = 0.001 ← use scaled int). */
  creditsPerUnit: CreditUnits;
  currency: CurrencyCode;
  /** ISO timestamp when this price was read. */
  snapshotAt: string;
  unitType: BillingUnitType;
}
