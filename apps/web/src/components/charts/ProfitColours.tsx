/**
 * Every profit chart, the same way (owner, 8 Nov 2026): green, with a green gradient, while in profit; red, with a red
 * gradient, while in loss. The colour changes exactly at £0, on the line and on the fill under it.
 *
 * Recharts lays a gradient over each shape's own box (objectBoundingBox), so the £0 split is worked out from the values:
 * for the line, where £0 falls between its highest and lowest point; for the fill, which is drawn between the line and
 * £0, where £0 falls between max(highest, 0) and min(lowest, 0).
 */
export const GAIN = "var(--hit)";
export const LOSS = "var(--loss)";

export function profitSplit(values: number[]) {
  const hi = values.length ? Math.max(...values) : 0;
  const lo = values.length ? Math.min(...values) : 0;
  const crosses = hi >= 0 && lo < 0;
  // £0 itself counts as profit, so a flat £0 start isn't red: the split sits a hair below the zero line.
  const lineSplit = crosses ? Math.min(1, hi / (hi - lo) + 0.005) : 1;
  const top = Math.max(hi, 0);
  const bottom = Math.min(lo, 0);
  const fillSplit = top - bottom > 0 ? top / (top - bottom) : 1;
  // A line that never crosses £0 is one colour: a gradient over a flat line (no height) would draw nothing.
  const whole = lo >= 0 ? GAIN : LOSS;
  return { crosses, lineSplit, fillSplit, whole, last: values.at(-1) ?? 0 };
}

/** The two gradients, inside a chart's <defs>: `${id}-stroke` for the line and `${id}-fill` for the area to £0. */
export function ProfitGradients({ id, split }: { id: string; split: ReturnType<typeof profitSplit> }) {
  const { lineSplit, fillSplit } = split;
  return (
    <>
      <linearGradient id={`${id}-stroke`} x1="0" y1="0" x2="0" y2="1">
        <stop offset={lineSplit} stopColor={GAIN} />
        <stop offset={lineSplit} stopColor={LOSS} />
      </linearGradient>
      <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
        <stop offset={0} stopColor={GAIN} stopOpacity={fillSplit > 0 ? 0.34 : 0} />
        <stop offset={fillSplit} stopColor={GAIN} stopOpacity={0.03} />
        <stop offset={fillSplit} stopColor={LOSS} stopOpacity={0.03} />
        <stop offset={1} stopColor={LOSS} stopOpacity={fillSplit < 1 ? 0.34 : 0} />
      </linearGradient>
    </>
  );
}

/** The class that makes the line glow in the colour it ends on (globals.css .glow-hit / .glow-loss). */
export const profitGlow = (split: ReturnType<typeof profitSplit>) => (split.last >= 0 ? "glow-hit" : "glow-loss");

/** The stroke to give the line: the split gradient, or one colour when it never crosses £0. */
export const profitStroke = (id: string, split: ReturnType<typeof profitSplit>) => (split.crosses ? `url(#${id}-stroke)` : split.whole);
