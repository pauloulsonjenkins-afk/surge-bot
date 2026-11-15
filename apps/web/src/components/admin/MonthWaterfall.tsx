"use client";

import { gbp, toneOf } from "@/lib/format";

/**
 * Profit's centrepiece (15 Nov 2026): how the month adds up. Each strategy's profit this month is one step, winners
 * first (biggest first) climbing from zero, then the losers stepping back down, ending on the month's total. The five
 * biggest each way are named; the rest are added together as "N smaller wins" or "N smaller losses".
 */
const W = 356;
const TOP = 26;
const PLOT = 190;
const LABELS = 128;
const NAMED = 5;

interface Step {
  name: string;
  value: number;
}

function steps(items: Step[]): Step[] {
  const fold = (list: Step[], word: string) => {
    if (list.length <= NAMED + 1) return list;
    const rest = list.slice(NAMED);
    return [...list.slice(0, NAMED), { name: `${rest.length} smaller ${word}`, value: rest.reduce((t, s) => t + s.value, 0) }];
  };
  const moved = items.filter((s) => Math.abs(s.value) >= 0.005);
  const wins = moved.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const losses = moved.filter((s) => s.value < 0).sort((a, b) => a.value - b.value);
  return [...fold(wins, "wins"), ...fold(losses, "losses")];
}

export function MonthWaterfall({ items, total, totalLabel }: { items: Step[]; total: number; totalLabel: string }) {
  const list = steps(items);
  if (list.length === 0) return null;
  const won = list.filter((s) => s.value > 0).reduce((t, s) => t + s.value, 0);
  const lost = -list.filter((s) => s.value < 0).reduce((t, s) => t + s.value, 0);

  // Each step runs from the running total before it to the one after.
  const bars = list.map((s, i) => {
    const from = list.slice(0, i).reduce((t, x) => t + x.value, 0);
    return { ...s, from, to: from + s.value };
  });
  const high = Math.max(0, ...bars.map((b) => Math.max(b.from, b.to)), total);
  const low = Math.min(0, ...bars.map((b) => Math.min(b.from, b.to)), total);
  const span = high - low || 1;
  const y = (v: number) => TOP + ((high - v) / span) * PLOT;
  const cols = bars.length + 1;
  const pitch = Math.min(34, (W - 24) / cols);
  const bw = Math.max(8, pitch - 6);
  const x = (i: number) => 12 + i * pitch;
  const biggest = Math.max(...bars.map((b) => Math.abs(b.value)));
  const figure = (v: number) => `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(2)}`;

  return (
    <section
      aria-label={`How ${totalLabel.toLowerCase()} adds up: winning strategies made ${gbp(won, false)}, losing ones cost ${gbp(lost, false)}, leaving ${gbp(total)}.`}
      className="rounded-xl border border-line bg-surface pb-1 pt-3.5"
    >
      <div className="px-3.5">
        <h3 className="font-display text-base font-bold text-ink [font-stretch:112%]">How {totalLabel.toLowerCase()} adds up</h3>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Winners made <b className="font-semibold text-hit">{gbp(won, false)}</b>. Losers gave back <b className="font-semibold text-loss">{gbp(lost, false)}</b>.
        </p>
      </div>
      <svg aria-hidden viewBox={`0 0 ${W} ${TOP + PLOT + LABELS}`} className="mx-auto mt-1 block w-full max-w-[420px]" fill="none">
        <defs>
          <linearGradient id="wf-up" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="var(--hit)" />
            <stop offset="1" stopColor="var(--hit)" stopOpacity=".65" />
          </linearGradient>
          <linearGradient id="wf-down" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="var(--loss)" />
            <stop offset="1" stopColor="var(--loss)" stopOpacity=".65" />
          </linearGradient>
          <linearGradient id="wf-total" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="var(--gold)" />
            <stop offset="1" stopColor="var(--accent)" />
          </linearGradient>
        </defs>
        <path d={`M8 ${y(0)}H${W - 8}`} stroke="var(--ink-muted)" strokeOpacity=".6" strokeWidth="1.5" />
        {bars.map((b, i) => {
          const top = y(Math.max(b.from, b.to));
          const h = Math.max(2, Math.abs(y(b.from) - y(b.to)));
          const up = b.value > 0;
          return (
            <g key={b.name}>
              <rect x={x(i)} y={top} width={bw} height={h} rx={Math.min(4, h / 2)} fill={up ? "url(#wf-up)" : "url(#wf-down)"} />
              {/* The thread to the next step, at the level this one ends on. */}
              <path d={`M${x(i) + bw} ${y(b.to)}H${x(i + 1)}`} stroke="var(--ink-muted)" strokeOpacity=".5" strokeDasharray="2 3" />
              {Math.abs(b.value) >= biggest * 0.3 && (
                <text x={x(i) + bw / 2} y={top - 5} fontSize="10.5" fontWeight="600" textAnchor="middle" fill={up ? "var(--hit)" : "var(--loss)"}>
                  {figure(b.value)}
                </text>
              )}
              <text transform={`translate(${x(i) + bw / 2 + 4} ${TOP + PLOT + 12}) rotate(-90)`} fontSize="11" textAnchor="end" fill="var(--ink-muted)">
                {b.name.length > 20 ? `${b.name.slice(0, 19)}…` : b.name}
              </text>
            </g>
          );
        })}
        <rect x={x(bars.length)} y={y(Math.max(0, total))} width={bw} height={Math.max(2, Math.abs(y(0) - y(total)))} rx="4" fill="url(#wf-total)" />
        <text transform={`translate(${x(bars.length) + bw / 2 + 4} ${TOP + PLOT + 12}) rotate(-90)`} fontSize="11" fontWeight="600" textAnchor="end" fill="var(--gold)">
          {totalLabel}, {gbp(total)}
        </text>
      </svg>
    </section>
  );
}

/** The big figure above the chart: a period's total, in the page's display face. */
export function ProfitHero({ label, total }: { label: string; total: number }) {
  return (
    <div>
      <p className="text-[13px] text-ink-muted">{label}</p>
      <p className={`font-display text-[3.5rem] font-black leading-[1.05] tracking-tight tabular-nums [font-stretch:125%] ${toneOf(total)}`}>{gbp(total)}</p>
    </div>
  );
}
