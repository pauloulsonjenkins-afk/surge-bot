"use client";

/**
 * Live's centrepiece (15 Nov 2026): the featured match as a clock. The ring is the 90 minutes, filled to about where
 * the match is now (an estimate: alerts carry no live clock), with each alert pinned at the minute it fired. The score
 * in the middle is the latest an alert reported. Which match is featured is the page's choice (live/page.tsx).
 */
export interface ClockPin {
  id: number;
  minute: number;
  /** real = money on it; gold = a Golden slice at candidate stage or better; sim = recorded only. */
  kind: "real" | "gold" | "sim";
}

const CX = 195;
const CY = 188;
const R = 118;

const at = (minute: number, r: number) => {
  const a = ((Math.min(90, Math.max(0, minute)) / 90) * 360 - 90) * (Math.PI / 180);
  return [Math.round((CX + r * Math.cos(a)) * 10) / 10, Math.round((CY + r * Math.sin(a)) * 10) / 10] as const;
};

export function MatchClock({
  home,
  away,
  competition,
  score,
  minute,
  clock,
  pins,
  why,
}: {
  home: string;
  away: string;
  competition: string | null;
  score: string;
  /** About where the match is now, 0 to 90, or null when it can't be told. */
  minute: number | null;
  /** The same as words: "about 60' now", "half time". */
  clock: string | null;
  pins: ClockPin[];
  /** Why this match is the featured one, in a few words. */
  why: string;
}) {
  const [ex, ey] = minute === null ? [CX, CY - R] : at(minute, R);
  const sweep = minute === null ? 0 : (Math.min(90, minute) / 90) * 360;
  // Alerts in the same minute share one pin, the most important kind showing.
  const order = { real: 0, gold: 1, sim: 2 } as const;
  const byMinute = new Map<number, ClockPin>();
  for (const p of [...pins].sort((a, b) => order[a.kind] - order[b.kind])) if (!byMinute.has(p.minute)) byMinute.set(p.minute, p);
  const shown = [...byMinute.values()];
  const summary = `${home} v ${away}, ${score}${clock ? `, ${clock}` : ""}. Alerts at ${shown.map((p) => `${p.minute}'`).join(", ") || "no minute given"}.`;

  return (
    <section aria-label={summary} className="relative mx-auto w-full max-w-[390px]">
      <svg aria-hidden viewBox="0 0 390 364" className="block w-full" fill="none">
        <defs>
          <linearGradient id="clock-progress" x1={CX} y1={CY - R} x2={CX} y2={CY + R} gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--ink)" />
            <stop offset="1" stopColor="var(--accent)" />
          </linearGradient>
          <filter id="clock-soft" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        {/* One mark a minute. */}
        <circle cx={CX} cy={CY} r={R + 16} stroke="var(--ink-muted)" strokeWidth="7" strokeDasharray="1.5 7.856" opacity=".6" transform={`rotate(-90 ${CX} ${CY})`} />
        {/* The pitch: a green face with the halfway line and centre circle. */}
        <circle cx={CX} cy={CY} r={R - 10} fill="color-mix(in srgb, var(--hit) 24%, var(--surface))" />
        <path d={`M${CX - R + 10} ${CY}H${CX + R - 10}`} stroke="var(--ink)" strokeOpacity=".16" strokeWidth="1.5" />
        <circle cx={CX} cy={CY} r="34" stroke="var(--ink)" strokeOpacity=".16" strokeWidth="1.5" />
        <circle cx={CX} cy={CY} r={R} stroke="var(--surface-2)" strokeWidth="12" />
        {minute !== null && sweep >= 359.5 ? (
          <circle cx={CX} cy={CY} r={R} stroke="url(#clock-progress)" strokeWidth="12" />
        ) : (
          minute !== null && sweep > 0 && <path d={`M${CX} ${CY - R} A${R} ${R} 0 ${sweep > 180 ? 1 : 0} 1 ${ex} ${ey}`} stroke="url(#clock-progress)" strokeWidth="12" strokeLinecap="round" />
        )}
        {minute !== null && (
          <>
            <circle cx={ex} cy={ey} r="13" fill="var(--accent)" filter="url(#clock-soft)" />
            <circle cx={ex} cy={ey} r="7" fill="var(--ink)" />
          </>
        )}
        {shown.map((p) => {
          const [px, py] = at(p.minute, R);
          const fill = p.kind === "real" ? "var(--accent)" : p.kind === "gold" ? "var(--gold)" : "var(--surface)";
          const ink = p.kind === "real" ? "var(--accent-ink)" : p.kind === "gold" ? "var(--app)" : "var(--ink)";
          return (
            <g key={p.id}>
              <circle cx={px} cy={py} r="15" fill={fill} stroke={p.kind === "sim" ? "var(--ink-muted)" : "var(--app)"} strokeWidth={p.kind === "sim" ? 1.5 : 3} />
              <text x={px} y={py + 4} fontSize="11" fontWeight="600" textAnchor="middle" fill={ink}>
                {p.minute}&apos;
              </text>
            </g>
          );
        })}
        <g fontSize="11" fill="var(--ink-muted)" textAnchor="middle">
          <text x={CX} y="42">0&apos;</text>
          <text x="338" y="110">15&apos;</text>
          <text x="340" y="274">30&apos;</text>
          <text x={CX} y="346">45&apos;</text>
          <text x="50" y="274">60&apos;</text>
          <text x="52" y="110">75&apos;</text>
        </g>
      </svg>
      <div className="absolute inset-x-0 top-[31%] px-[27%] text-center">
        {competition && <p className="truncate text-xs text-ink-muted">{competition}</p>}
        <p className="truncate font-display text-[15px] font-bold text-ink [font-stretch:110%]">{home}</p>
        <p className="font-display text-[3.4rem] font-black leading-none tracking-tight tabular-nums text-ink [font-stretch:125%]">{score}</p>
        <p className="truncate font-display text-[15px] font-bold text-ink [font-stretch:110%]">{away}</p>
      </div>
      <p className="-mt-2 text-center text-xs text-ink-muted">
        {clock && <span className="font-semibold text-ink">{clock}</span>}
        {clock && " · "}
        {why}
      </p>
    </section>
  );
}
