import { useId } from "react";

/**
 * A small running-profit line: green when it ends up, red when down, with a faint line at zero. No axes: it shows the
 * shape (steady climb, one big loss, a slide), and the figures beside it give the size. The space between the line and
 * zero is tinted, fading away from the line, and a dot marks where it stands now (13 Nov 2026).
 */
export function Sparkline({ values, width = 72, height = 22, label }: { values: number[]; width?: number; height?: number; label?: string }) {
  const id = useId();
  if (values.length < 2) return null;
  const pts = [0, ...values];
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  // 2px clear at the top, bottom and right, so the end dot isn't clipped.
  const x = (i: number) => (i / (pts.length - 1)) * (width - 4) + 1;
  const y = (v: number) => height - 2 - ((v - min) / span) * (height - 4);
  const d = pts.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const end = pts[pts.length - 1]!;
  const up = end >= 0;
  const zero = y(0).toFixed(1);
  const area = `${d} L${x(pts.length - 1).toFixed(1)},${zero} L${x(0).toFixed(1)},${zero} Z`;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label ?? `Running profit, last ${values.length} bets`}
      className="spark shrink-0"
      style={{ color: up ? "var(--hit)" : "var(--loss)" }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity={up ? 0.34 : 0.04} />
          <stop offset="1" stopColor="currentColor" stopOpacity={up ? 0.04 : 0.34} />
        </linearGradient>
      </defs>
      <line x1={0} x2={width} y1={zero} y2={zero} stroke="var(--line)" strokeWidth={1} />
      <path d={area} fill={`url(#${id})`} stroke="none" />
      <path className="spark-line" d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(pts.length - 1)} cy={y(end)} r={2} fill="currentColor" />
    </svg>
  );
}
