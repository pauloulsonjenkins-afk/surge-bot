"use client";

import { gbp, toneOf } from "@/lib/format";
import { Flash } from "@/components/ui/Flash";

/**
 * Home's centrepiece: today's Live profit inside a dial. The marker is the share of today's bets that won; the tick is
 * the share that needs to win to break even at today's odds. The dial runs from 30% to 80% (anything outside sits at the
 * end). Underneath, the same thing in words and bets: "3 of 10 won; 6 would break even".
 */
const CX = 195;
const CY = 200;
const R = 140;
const LOW = 30;
const HIGH = 80;
const START = 150; // degrees, clockwise from 3 o'clock: the dial opens at the bottom
const SWEEP = 240;

const angleOf = (pct: number) => START + ((Math.min(HIGH, Math.max(LOW, pct)) - LOW) / (HIGH - LOW)) * SWEEP;
const pointAt = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return [Math.round((CX + r * Math.cos(a)) * 10) / 10, Math.round((CY + r * Math.sin(a)) * 10) / 10] as const;
};
const arc = (from: number, to: number, r: number) => {
  const [x0, y0] = pointAt(from, r);
  const [x1, y1] = pointAt(to, r);
  return `M${x0} ${y0} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`;
};

export function BrewGauge({
  net,
  hitRate,
  needs,
  won,
  lost,
  loading = false,
  children,
}: {
  /** Today's Live profit in pounds. */
  net: number;
  /** Today's hit rate and the rate needed to break even, in percent; null when nothing has settled or it can't be worked out. */
  hitRate: number | null;
  needs: number | null;
  won: number;
  lost: number;
  /** The won / lost figures are still loading: show placeholders, not zeros. */
  loading?: boolean;
  /** A line under the won and lost counts (today's Sim figure). */
  children?: React.ReactNode;
}) {
  const settled = won + lost;
  const ahead = hitRate !== null && needs !== null ? hitRate >= needs : net >= 0;
  const colour = hitRate === null ? "var(--ink-muted)" : ahead ? "var(--hit)" : "var(--loss)";
  // How many of today's settled bets needed to win to break even at today's odds.
  const toBreakEven = needs !== null && settled > 0 ? Math.min(settled, Math.ceil((needs / 100) * settled - 1e-9)) : null;
  const at = hitRate === null ? null : angleOf(hitRate);
  const [mx, my] = at === null ? [0, 0] : pointAt(at, R);
  const tick = needs === null ? null : angleOf(needs);
  const [tx0, ty0] = tick === null ? [0, 0] : pointAt(tick, R - 15);
  const [tx1, ty1] = tick === null ? [0, 0] : pointAt(tick, R + 17);
  const [lx, ly] = tick === null ? [0, 0] : pointAt(tick, R + 30);
  const plain =
    toBreakEven === null
      ? null
      : ahead
        ? `${toBreakEven} of the ${settled} winning would break even at today's odds, so you're ahead.`
        : `You'd need ${toBreakEven} of the ${settled} to win to break even at today's odds.`;
  const summary = loading
    ? `Live today ${gbp(net, false)}.`
    : hitRate === null
      ? `Live today ${gbp(net, false)}. Nothing settled yet.`
      : `Live today ${gbp(net, false)}. ${won} of ${settled} bets won. ${plain ?? ""}`;

  return (
    <section aria-label={summary} className="relative mx-auto w-full max-w-[390px]">
      <svg aria-hidden viewBox="0 0 390 300" className="block w-full overflow-visible" fill="none">
        <defs>
          <radialGradient id="brew-glow" cx={CX} cy={CY} r="150" gradientUnits="userSpaceOnUse">
            <stop stopColor={colour} stopOpacity=".2" />
            <stop offset="1" stopColor={colour} stopOpacity="0" />
          </radialGradient>
          <filter id="brew-soft" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>
        <circle cx={CX} cy={CY} r="150" fill="url(#brew-glow)" />
        {/* The scale: one mark per 1%. */}
        <path d={arc(START, START + SWEEP, R + 20)} stroke="var(--ink-muted)" strokeWidth="7" strokeDasharray="1.5 11.9" opacity=".6" />
        <path d={arc(START, START + SWEEP, R)} stroke="var(--surface-2)" strokeWidth="16" strokeLinecap="round" />
        {at !== null && <path d={arc(START, at, R)} stroke={colour} strokeWidth="16" strokeLinecap="round" />}
        {tick !== null && (
          <>
            <line x1={tx0} y1={ty0} x2={tx1} y2={ty1} stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" />
            {/* Two short lines, so a mark far round the dial (67.8%) doesn't run off the side of the drawing. */}
            <text x={lx} y={ly - 7} fill="var(--ink-muted)" fontSize="11" textAnchor={lx > CX + 20 ? "start" : lx < CX - 20 ? "end" : "middle"} dominantBaseline="middle">
              <tspan x={lx} className="font-semibold" fill="var(--ink)">{needs}%</tspan>
              <tspan x={lx} dy="13">to break even</tspan>
            </text>
          </>
        )}
        {at !== null && (
          <>
            <circle cx={mx} cy={my} r="16" fill={colour} filter="url(#brew-soft)" opacity=".9" />
            <circle cx={mx} cy={my} r="10" fill="var(--ink)" />
            <circle cx={mx} cy={my} r="4" fill={colour} />
          </>
        )}
      </svg>
      <div className="absolute inset-x-0 top-[37%] text-center">
        <p className="text-[13px] text-ink-muted">Live today</p>
        <p className="font-display text-[3.25rem] font-extrabold leading-[1.1] tracking-tight tabular-nums [font-stretch:125%]">
          <Flash value={net}>
            <span className={toneOf(net)}>{gbp(net, false)}</span>
          </Flash>
        </p>
        <p className="mt-1 text-[15px]">
          {loading ? (
            <span className="text-ink-muted">Loading today&apos;s bets…</span>
          ) : hitRate === null ? (
            <span className="text-ink-muted">Nothing settled yet</span>
          ) : (
            <b className={`font-semibold ${ahead ? "text-hit" : "text-loss"}`}>
              {won} of {settled} won
            </b>
          )}
        </p>
      </div>
      <div className="-mt-1 flex flex-wrap items-center justify-center gap-2 text-[13px]">
        <span className="rounded-full bg-hit/15 px-3 py-1 font-semibold text-hit">{loading ? "–" : won} won</span>
        <span className="rounded-full bg-loss/15 px-3 py-1 font-semibold text-loss">{loading ? "–" : lost} lost</span>
        {children}
      </div>
      {!loading && plain && <p className="mt-2 text-center text-sm text-ink-muted">{plain}</p>}
    </section>
  );
}
