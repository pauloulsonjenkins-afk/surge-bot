/**
 * A hit rate as a bar with a mark where break-even is, so above or below reads at a glance: green when it clears
 * break-even, red when it doesn't. The faint band is where the true hit rate probably is; while it straddles the mark
 * there are too few picks to call it. Built from spans so it can sit inside a button.
 */
export function BreakevenBar({
  hitRate,
  breakeven,
  range,
  caption = true,
}: {
  hitRate: number | null;
  breakeven: number | null | undefined;
  range?: { low: number; high: number } | null;
  /** "needs 60%" under the bar. */
  caption?: boolean;
}) {
  if (hitRate === null || breakeven === null || breakeven === undefined) return null;
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const above = hitRate >= breakeven;
  return (
    <span className="block">
      <span className="relative block h-1.5 rounded-full bg-surface-2" role="img" aria-label={`Hit rate ${hitRate}%, break-even ${breakeven}%`}>
        {range && (
          <span
            className="absolute inset-y-0 block rounded-full bg-ink-muted/25"
            style={{ left: `${clamp(range.low)}%`, width: `${clamp(range.high) - clamp(range.low)}%` }}
          />
        )}
        <span className={`absolute inset-y-0 left-0 block rounded-full ${above ? "bg-hit" : "bg-loss"}`} style={{ width: `${clamp(hitRate)}%` }} />
        <span className="absolute -inset-y-1 block w-0.5 rounded-full bg-ink" style={{ left: `calc(${clamp(breakeven)}% - 1px)` }} />
      </span>
      {caption && <span className="mt-1 block text-xs text-ink-muted">needs {breakeven}%</span>}
    </span>
  );
}
