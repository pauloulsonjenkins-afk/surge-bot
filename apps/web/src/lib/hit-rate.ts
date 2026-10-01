/**
 * Reading a hit rate against the odds. A hit rate on its own says nothing about money: 63.8% loses at average odds of
 * 1.50, where breaking even needs 66.7%. And with few picks the true rate could be well above or below what was seen.
 */

/** 0.124 -> "+12.4%": the return on each £1 staked. */
export function roiText(roi: number | null | undefined): string {
  if (roi === null || roi === undefined) return "–";
  const pct = Math.round(roi * 1000) / 10;
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct)}%`;
}

export function rangeText(range: { low: number; high: number } | null | undefined): string | null {
  return range ? `${Math.round(range.low)}–${Math.round(range.high)}%` : null;
}

/**
 * Whether the hit rate clears break-even, judged on its likely range rather than the single figure:
 *   above  the whole range is above break-even
 *   below  the whole range is below it
 *   unsure the range straddles it, so more picks are needed before it can be called
 */
export function againstBreakeven(
  hitRate: number | null,
  breakeven: number | null | undefined,
  range: { low: number; high: number } | null | undefined,
): { tone: "hit" | "loss" | "muted"; text: string } | null {
  if (hitRate === null || breakeven === null || breakeven === undefined) return null;
  const gap = Math.round((hitRate - breakeven) * 10) / 10;
  const by = `${Math.abs(gap)} pts ${gap >= 0 ? "above" : "below"} break-even`;
  if (range && range.low > breakeven) return { tone: "hit", text: `${by}, even at the low end of its range` };
  if (range && range.high < breakeven) return { tone: "loss", text: `${by}, even at the top of its range` };
  return { tone: "muted", text: `${by}; too few picks to be sure either way` };
}
