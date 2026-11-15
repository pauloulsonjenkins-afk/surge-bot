"use client";

import { roiText } from "@/lib/hit-rate";

/**
 * Strategies' centrepiece (15 Nov 2026): "Proven or just lucky?" Every strategy is one dot, placed by how many bets
 * its record has (across, on a square-root scale so the small ones aren't squashed) and its return per £1 (up). Right
 * of the dashed line a record has enough bets to judge (`enough`); the top-right is winning with enough bets, which
 * is the only corner that means anything. Returns beyond ±20% sit at the edge with their real figure in the label.
 */
export interface ProofPoint {
  key: string;
  name: string;
  href: string;
  bets: number;
  /** Return per £1 as a fraction (0.073 = +7.3%). */
  roi: number;
  live: boolean;
}

const X0 = 44;
const X1 = 372;
const Y0 = 30;
const Y1 = 250;
const MID = (Y0 + Y1) / 2;
const CAP = 0.2;

export function ProofChart({ points, enough }: { points: ProofPoint[]; enough: number }) {
  const shown = points.filter((p) => p.bets > 0 && Number.isFinite(p.roi));
  if (shown.length < 2) return null;
  const maxBets = Math.max(400, ...shown.map((p) => p.bets));
  const x = (bets: number) => X0 + (Math.sqrt(bets) / Math.sqrt(maxBets)) * (X1 - X0);
  const y = (roi: number) => MID - (Math.max(-CAP, Math.min(CAP, roi)) / CAP) * (MID - Y0);
  const lineX = x(enough);
  const ticks = [10, enough, 100, 200, 400, 800, 1600].filter((t, i, a) => t <= maxBets && a.indexOf(t) === i);
  // Named on the chart: Live strategies and the well-tested ones, biggest record first, skipping a label that would
  // sit on one already drawn. Every dot still carries its name for a pointer and for screen readers.
  const placed: Array<{ x: number; y: number }> = [];
  const labelled = new Set<string>();
  for (const p of [...shown].sort((a, b) => Number(b.live) - Number(a.live) || b.bets - a.bets)) {
    if (!p.live && p.bets < enough * 2) continue;
    const at = { x: x(p.bets), y: y(p.roi) };
    if (placed.some((q) => Math.abs(q.y - at.y) < 15 && Math.abs(q.x - at.x) < 120)) continue;
    placed.push(at);
    labelled.add(p.key);
  }
  const proven = shown.filter((p) => p.bets >= enough && p.roi > 0).length;

  return (
    <section aria-label={`Each strategy by number of bets and return. ${proven} winning with at least ${enough} bets.`}>
      <p className="text-[15px] text-ink">
        <b className="font-semibold">Proven or just lucky?</b> <span className="text-ink-muted">Right of the line has enough bets to judge.</span>
      </p>
      <svg viewBox="0 0 390 284" className="mt-1 block w-full" fill="none" role="img" aria-label="Strategies plotted by bets and return">
        <defs>
          <linearGradient id="proof-win" x1="0" y1={Y0} x2="0" y2={MID} gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--hit)" stopOpacity=".26" />
            <stop offset="1" stopColor="var(--hit)" stopOpacity=".04" />
          </linearGradient>
          <linearGradient id="proof-lose" x1="0" y1={MID} x2="0" y2={Y1} gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--loss)" stopOpacity=".04" />
            <stop offset="1" stopColor="var(--loss)" stopOpacity=".24" />
          </linearGradient>
        </defs>
        <rect x={lineX} y={Y0} width={X1 - lineX} height={MID - Y0} fill="url(#proof-win)" rx="6" />
        <rect x={lineX} y={MID} width={X1 - lineX} height={Y1 - MID} fill="url(#proof-lose)" rx="6" />
        <path d={`M${X0} ${(Y0 + MID) / 2}H${X1}M${X0} ${(MID + Y1) / 2}H${X1}`} stroke="var(--ink)" strokeOpacity=".08" />
        <path d={`M${X0} ${MID}H${X1}`} stroke="var(--ink-muted)" strokeOpacity=".7" strokeWidth="1.5" />
        <path d={`M${lineX} ${Y0 - 6}V${Y1 + 6}`} stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 4" />
        <g fontSize="11" fill="var(--ink-muted)">
          <text x={X0 - 6} y={Y0 + 4} textAnchor="end">+20%</text>
          <text x={X0 - 6} y={(Y0 + MID) / 2 + 4} textAnchor="end">+10%</text>
          <text x={X0 - 6} y={MID + 4} textAnchor="end">0</text>
          <text x={X0 - 6} y={(MID + Y1) / 2 + 4} textAnchor="end">−10%</text>
          <text x={X0 - 6} y={Y1 + 4} textAnchor="end">−20%</text>
          {ticks.map((t) => (
            <text key={t} x={x(t)} y={Y1 + 24} textAnchor="middle" fill={t === enough ? "var(--accent)" : undefined} fontWeight={t === enough ? 600 : undefined}>
              {t === enough ? `${t} bets` : t}
            </text>
          ))}
          <text x={X1 - 6} y={Y0 + 16} textAnchor="end" fill="var(--hit)" fontWeight="600">Winning</text>
          <text x={X1 - 6} y={Y1 - 8} textAnchor="end" fill="var(--loss)" fontWeight="600">Losing</text>
        </g>
        {shown.map((p) => {
          const cx = x(p.bets);
          const cy = y(p.roi);
          const off = Math.abs(p.roi) > CAP;
          const left = cx > 250;
          return (
            <a key={p.key} href={p.href} aria-label={`${p.name}: ${p.bets} bets, ${roiText(p.roi)} per £1, ${p.live ? "Live" : "Sim"}`}>
              <title>{`${p.name}: ${p.bets} bets, ${roiText(p.roi)}`}</title>
              {/* A wide clear circle, so a dot is easy to tap. */}
              <circle cx={cx} cy={cy} r="14" fill="transparent" />
              {p.live ? <circle cx={cx} cy={cy} r="7.5" fill="var(--accent)" stroke="var(--app)" strokeWidth="2" /> : <circle cx={cx} cy={cy} r="6" stroke="var(--ink-muted)" strokeWidth="1.5" fill="var(--app)" fillOpacity=".4" />}
              {labelled.has(p.key) && (
                <text x={left ? cx - 12 : cx + 12} y={cy + 4} textAnchor={left ? "end" : "start"} fontSize="11.5" fontWeight="500" fill="var(--ink)">
                  {p.name.length > 22 ? `${p.name.slice(0, 21)}…` : p.name}
                  {off ? `, ${roiText(p.roi)}` : ""}
                </text>
              )}
            </a>
          );
        })}
      </svg>
      <div className="flex gap-4 text-xs text-ink-muted">
        <span className="flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full bg-accent" />
          Live, real money
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full border-[1.5px] border-ink-muted" />
          Sim
        </span>
      </div>
    </section>
  );
}
