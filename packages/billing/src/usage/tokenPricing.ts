export interface TokenPrice {
  completionPerK: bigint;
  promptPerK: bigint;
}

/** Sum both token classes at their own rates, then round once to whole credits. */
export function priceTokens(promptTokens: number, completionTokens: number, price: TokenPrice) {
  if (![promptTokens, completionTokens].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    price.promptPerK < 0n || price.completionPerK < 0n) throw new Error('Invalid token usage or price');
  const thousandths = BigInt(promptTokens) * price.promptPerK + BigInt(completionTokens) * price.completionPerK;
  return (thousandths + 999n) / 1000n;
}
