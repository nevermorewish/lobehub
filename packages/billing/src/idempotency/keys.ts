import { createHash } from 'node:crypto';

/**
 * Idempotency key convention for billing operations.
 *
 * Keys are deterministic and scoped to a (billingAccountId, requestId, suffix).
 * This makes retry-safe operations trivial — the caller just passes the same
 * requestId again and the repository detects the duplicate via the unique index.
 *
 * Key format:  `billing:<suffix>:<billingAccountId>:<requestId>`
 *
 * Where suffix is one of:
 *   hold    – pre-reserve before provider call
 *   debit   – actual charge after settle
 *   release – return of over-estimate or full cancel
 *   credit  – top-up from an order
 *   manual  – admin manual adjustment (uses operationId instead of requestId)
 */

export type IdempotencyKeySuffix = 'hold' | 'debit' | 'release' | 'credit' | 'manual';

/**
 * Builds a deterministic idempotency key.
 *
 * @example
 * buildIdempotencyKey('hold', 'bac_abc', 'req_xyz')
 * // → 'billing:hold:bac_abc:req_xyz'
 */
export function buildIdempotencyKey(
  suffix: IdempotencyKeySuffix,
  billingAccountId: string,
  requestOrOperationId: string,
): string {
  const key = `billing:${suffix}:${billingAccountId}:${requestOrOperationId}`;
  return key.length <= 128 ? key : `billing:${suffix}:${createHash('sha256').update(JSON.stringify([billingAccountId, requestOrOperationId])).digest('hex')}`;
}

/**
 * Builds the pair of idempotency keys needed for a settle operation.
 * Returns deterministic keys so a retry of settle never double-debits.
 */
export function buildSettleKeys(billingAccountId: string, requestId: string) {
  return {
    debitKey: buildIdempotencyKey('debit', billingAccountId, requestId),
    releaseKey: buildIdempotencyKey('release', billingAccountId, requestId),
  };
}

/**
 * Validates that a requestId meets the minimum contract:
 *  - non-empty string
 *  - no whitespace or control characters
 *  - max 128 chars (matches the DB column)
 */
export function validateRequestId(requestId: string): void {
  if (!requestId || requestId.trim() !== requestId) {
    throw new TypeError('requestId must be a non-empty trimmed string');
  }
  if (requestId.length > 128) {
    throw new TypeError('requestId must not exceed 128 characters');
  }
  if (/\s/.test(requestId) || [...requestId].some((character) => character.charCodeAt(0) < 32)) {
    throw new TypeError('requestId must not contain whitespace or control characters');
  }
}
