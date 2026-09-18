/** CNY amounts remain integer fen from API through display. */
export function money(fen: string) {
  const amount = BigInt(fen);
  return `¥${(amount / 100n).toLocaleString()}.${(amount % 100n).toString().padStart(2, '0')}`;
}
