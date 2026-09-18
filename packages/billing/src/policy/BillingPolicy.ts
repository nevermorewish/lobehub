/**
 * BillingPolicy — provider-neutral charge-mode decision.
 *
 * Determines how a single model request should be billed BEFORE the provider
 * is called.  This module has zero provider-SDK imports; the application
 * middleware supplies the context.
 *
 * Decision tree (from BYOK.md §3):
 *
 *   1. If provider is platform-managed → `platform` (always charge)
 *   2. Else if user has a valid credential for this provider → `byok`
 *      (or `gateway_fee` if the admin surcharge switch is on)
 *   3. Else → `platform`
 */
import type { ChargeMode } from '../types/commands';

// ─────────────────────────────────────────────────────────────────────────────
// Context supplied by the application layer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything the policy needs to decide the charge mode.
 * The billing package never reads keyVaults or DB directly — that's the
 * application middleware's job.
 */
export interface BillingContext {
  /**
   * Admin configuration: is BYOK permitted globally?
   * When false, all requests are charged as `platform` regardless of user keys.
   */
  byokAllowed: boolean;
  /**
   * Admin configuration: charge a gateway surcharge for BYOK requests?
   * Only takes effect when `byokAllowed` is true and `userHasProviderKey` is true.
   */
  gatewayFeeEnabled: boolean;
  /**
   * Whether this provider is flagged as platform-managed (i.e. users may NOT
   * override the API key).  Example: the built-in "lobehub" provider.
   */
  isPlatformManagedProvider: boolean;
  /** Slug of the provider being called, e.g. "openai", "anthropic". */
  provider: string;
  /**
   * Whether the user has a valid (non-empty, non-revoked) API key for this
   * provider stored in their keyVaults.  The application layer checks this;
   * the billing package trusts the boolean.
   */
  userHasProviderKey: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Policy
// ─────────────────────────────────────────────────────────────────────────────

export interface ChargeModeDecision {
  chargeMode: ChargeMode;
  /**
   * Human-readable explanation for logging and debugging.
   * MUST NOT be sent to the client; informational only.
   */
  reason: string;
}

/**
 * Determines the charge mode for a single model call.
 * Pure function — no side effects.
 *
 * @example
 * const decision = resolveChargeMode({
 *   provider: 'openai',
 *   userHasProviderKey: true,
 *   isPlatformManagedProvider: false,
 *   byokAllowed: true,
 *   gatewayFeeEnabled: false,
 * });
 * // → { chargeMode: 'byok', reason: '...' }
 */
export function resolveChargeMode(ctx: BillingContext): ChargeModeDecision {
  if (ctx.isPlatformManagedProvider) {
    return {
      chargeMode: 'platform',
      reason: `Provider "${ctx.provider}" is platform-managed; platform billing always applies.`,
    };
  }

  if (!ctx.byokAllowed) {
    return {
      chargeMode: 'platform',
      reason: 'BYOK is disabled globally by admin; using platform billing.',
    };
  }

  if (ctx.userHasProviderKey) {
    const mode: ChargeMode = ctx.gatewayFeeEnabled ? 'gateway_fee' : 'byok';
    return {
      chargeMode: mode,
      reason: `User has a key for provider "${ctx.provider}"; charge mode = ${mode}.`,
    };
  }

  return {
    chargeMode: 'platform',
    reason: `No user key for provider "${ctx.provider}"; falling back to platform billing.`,
  };
}

/**
 * Convenience guard: returns true when the request should deduct platform credits.
 */
export function requiresPlatformCharge(ctx: BillingContext): boolean {
  const { chargeMode } = resolveChargeMode(ctx);
  return chargeMode === 'platform' || chargeMode === 'gateway_fee';
}
