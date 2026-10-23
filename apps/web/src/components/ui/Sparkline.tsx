/**
 * A small running-profit line: green when it ends up, red when down, with a faint line at zero. No axes: it shows the
 * shape (steady climb, one big loss, a slide), and the figures beside it give the size.
 */
export function Sparkline({ values, width = 72, height = 22, label }: { values: number[]; width?: number; height?: number; label?: string }) {
  if (values.length < 2) return null;
  const pts = [0, ...values];
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const x = (i: number) => (i / (pts.length - 1)) * (width - 2) + 1;
  const y = (v: number) => height - 1 - ((v - min) / span) * (height - 2);
  const d = pts.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const end = pts[pts.length - 1]!;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label ?? `Running profit, last ${values.length} bets`} className="shrink-0">
      <line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeWidth={1} />
      <path d={d} fill="none" stroke={end >= 0 ? "var(--hit)" : "var(--loss)"} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
