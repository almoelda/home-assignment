/**
 * Cross-multiplication comparison for two ratios, avoiding any division.
 * Returns negative if a's ratio is GREATER (sorts first — "descending"), positive if
 * smaller, zero if equal. Uses BigInt per IMPLEMENTATION_PLAN.md §2: "views x cents can
 * exceed 2^53" — plain number multiplication would silently lose precision at scale.
 *
 * Precondition: both denominators are positive (guaranteed by DB CHECK constraints on
 * amount_cents and min_fee_cents; never zero in practice).
 */
export function compareRatioDescending(
  aNumerator: number,
  aDenominator: number,
  bNumerator: number,
  bDenominator: number,
): number {
  const left = BigInt(aNumerator) * BigInt(bDenominator);
  const right = BigInt(bNumerator) * BigInt(aDenominator);
  if (left > right) return -1;
  if (left < right) return 1;
  return 0;
}

/**
 * Exact validation that amountCents*1000 <= estimatedViews*maxCpmCents, without computing
 * the (rounded) max payment first. IMPLEMENTATION_PLAN.md §4.3: "no rounded intermediates."
 */
export function isWithinMaxCpm(
  amountCents: number,
  estimatedViews: number,
  maxCpmCents: number,
): boolean {
  return BigInt(amountCents) * 1000n <= BigInt(estimatedViews) * BigInt(maxCpmCents);
}
