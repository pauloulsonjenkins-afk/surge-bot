"use client";

import Link from "next/link";
import type { HitRateStats } from "@/queries/use-stats";
import { moneyTone } from "@/components/ui/Card";
import { formatNumber } from "@/lib/format";
import { Skeleton } from "@/components/ui/Skeleton";
import { gbp } from "@/components/admin/WinLossLines";
import type { Timeframe } from "./TimeframeToggle";
import type { PickMode } from "@/server/engine-client";
import { againstBreakeven, rangeText, roiText } from "@/lib/hit-rate";
import { useMe } from "@/queries/use-me";
import { useSending } from "@/queries/use-sending";
import { useUnplaced } from "@/queries/use-unplaced";
import { BreakevenBar } from "@/components/ui/BreakevenBar";

const TONE = { hit: "text-hit", loss: "text-loss", muted: "text-ink", ink: "text-ink" } as const;

/**
 * The Dashboard's top: one number to read first, then the figures that explain it.
 *   Admin:    profit is the big number; return, record, hit rate (against break-even) and odds sit underneath, and a
 *             strip above says whether sending is on and what needs looking at.
 *   Everyone: hit rate is the big number (money figures are private).
 * Every figure here, the profit included, comes from the same picks over the same window (stats.context), so they
 * always agree; the sentence under them leads with the money, so it can't say "above break-even" while losing.
 * Calendar figures (this month, this year, after running costs) are on Win/Loss.
 */
const WINDOW: Record<Timeframe, string> = { "1D": "Today", "7D": "Last 7 days", "30D": "Last 30 days", ALL: "All time" };

export function HeroRow({
  stats,
  isLoading,
  timeframe,
  mode,
}: {
  stats: HitRateStats | undefined;
  isLoading: boolean;
  timeframe: Timeframe;
  /** The strategy the Dashboard is filtered to; the stats passed in are already for it. */
  strategy: string | null;
  mode: PickMode;
}) {
  const admin = useMe().data?.admin === true;

  if (isLoading || !stats) return <HeroSkeleton />;

  const { totals } = stats;
  const c = stats.context;
  const settled = totals.hits + totals.misses;
  // The money over exactly the picks the figures below count. Null for anyone but the admin (the stats route removes it).
  const money = c && typeof c.profit === "number" ? { profit: c.profit, staked: c.staked ?? 0 } : null;
  const hitRate = totals.hitRate === null ? "–" : `${totals.hitRate}%`;
  const breakeven = c?.breakeven ?? null;

  const record = (
    <>
      <span className="text-hit">{totals.hits}</span>
      <span className="text-ink-muted">–</span>
      <span className="text-loss">{totals.misses}</span>
    </>
  );

  const secondary = [
    `${formatNumber(totals.alerts)} alerts`,
    totals.pending > 0 ? (
      <Link key="pending" href="/live" className="underline hover:text-ink">
        {formatNumber(totals.pending)} awaiting result
      </Link>
    ) : (
      "0 awaiting result"
    ),
    totals.needsReview > 0 ? `${totals.needsReview} need review` : null,
  ].filter(Boolean);

  return (
    <section aria-label="Summary" className="space-y-4">
      {admin && <StatusStrip pending={totals.pending} />}

      {money ? (
        <Hero
          label={`${mode === "sim" ? "Sim profit" : mode === "live" ? "Live profit" : "Profit"} · ${WINDOW[timeframe]}`}
          value={money.profit === 0 ? "£0.00" : gbp(money.profit)}
          tone={moneyTone(money.profit)}
          sub={
            <>
              {money.staked > 0 && <span className="tabular-nums">{gbp(money.staked, false)} staked · </span>}
              <Link href="/more/admin/winloss" className="underline hover:text-ink">
                Win/Loss
              </Link>
            </>
          }
        />
      ) : (
        <Hero
          label="Hit rate"
          value={hitRate}
          tone="ink"
          sub={settled === 0 ? "No settled picks yet" : `from ${formatNumber(settled)} settled${c?.range ? ` · likely ${rangeText(c.range)}` : ""}`}
        />
      )}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        {money && c?.roi != null && <Figure label="Return per £1" value={roiText(c.roi)} tone={moneyTone(c.roi)} />}
        <Figure label="Hits – Misses" value={record} />
        {money ? (
          <Figure
            label="Hit rate"
            value={hitRate}
            below={<span className="mt-1.5 block"><BreakevenBar hitRate={totals.hitRate} breakeven={breakeven} range={c?.range ?? null} /></span>}
          />
        ) : (
          <Figure label="Break-even hit rate" value={breakeven === null ? "–" : `${breakeven}%`} below={<span className="mt-1.5 block"><BreakevenBar hitRate={totals.hitRate} breakeven={breakeven} range={c?.range ?? null} /></span>} />
        )}
        <Figure label="Average odds" value={c?.avgOdds == null ? "–" : c.avgOdds.toFixed(2)} />
      </dl>

      <Verdict stats={stats} money={money !== null} />

      <p className="text-xs text-ink-muted">
        {secondary.map((s, i) => (
          <span key={i}>
            {i > 0 && " · "}
            {s}
          </span>
        ))}
      </p>
    </section>
  );
}

/** The one number to read first. */
function Hero({ label, value, tone, sub }: { label: string; value: React.ReactNode; tone: keyof typeof TONE; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={`mt-1 font-display text-hero font-bold tabular-nums [font-stretch:112%] ${TONE[tone]}`}>{value}</p>
      {sub && <p className="mt-1.5 text-sm text-ink-muted">{sub}</p>}
    </div>
  );
}

/** A supporting figure under the big number. */
function Figure({ label, value, tone = "ink", below }: { label: string; value: React.ReactNode; tone?: keyof typeof TONE; below?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className={`mt-0.5 font-display text-xl font-bold tabular-nums [font-stretch:108%] ${TONE[tone]}`}>{value}</dd>
      {below}
    </div>
  );
}

/**
 * One sentence on how it's going. Where the return is known (admin) it leads with the money, then says whether the
 * hit rate is clearly above or below break-even or too close to call; for everyone else it judges the hit rate alone.
 */
function Verdict({ stats, money }: { stats: HitRateStats; money: boolean }) {
  const c = stats.context;
  if (!c || c.settled === 0) return null;
  let text: string;
  let tone: keyof typeof TONE;
  if (money && c.roi !== null && c.counted > 0) {
    const pence = Math.round(Math.abs(c.roi) * 1000) / 10;
    const over = `over ${formatNumber(c.counted)} priced pick${c.counted === 1 ? "" : "s"}`;
    const lead = c.roi > 0 ? `Making ${pence}p per £1 staked ${over}` : c.roi < 0 ? `Losing ${pence}p per £1 staked ${over}` : `Breaking even ${over}`;
    const clearlyAbove = c.range != null && c.breakeven !== null && c.range.low > c.breakeven;
    const clearlyBelow = c.range != null && c.breakeven !== null && c.range.high < c.breakeven;
    if (c.roi < 0 && clearlyAbove) text = `${lead}, though the hit rate is clearly above break-even: look at the stakes on the losing strategies.`;
    else if (c.roi > 0 && clearlyBelow) text = `${lead}, though the hit rate is below break-even: a few long prices are carrying it.`;
    else if (clearlyAbove) text = `${lead}, and the hit rate is clearly above break-even.`;
    else if (clearlyBelow) text = `${lead}, and the hit rate is clearly below break-even.`;
    else text = `${lead}. Too few picks to call it yet.`;
    tone = moneyTone(c.roi);
  } else {
    const call = againstBreakeven(stats.totals.hitRate, c.breakeven, c.range);
    text = call ? `${call.text.charAt(0).toUpperCase()}${call.text.slice(1)}.` : "No odds are known for these picks, so break-even can’t be worked out yet.";
    tone = call?.tone ?? "muted";
  }
  return (
    <p className="text-sm">
      <span className={TONE[tone]}>{text}</span>
      {c.oddsKnown < c.settled && c.oddsKnown > 0 && (
        <span className="text-ink-muted"> Odds known for {formatNumber(c.oddsKnown)} of {formatNumber(c.settled)} picks.</span>
      )}
      {c.assumed ? (
        <span className="text-warn"> {formatNumber(c.assumed)} priced at an assumed price set on Win/Loss, so the return is partly a guess.</span>
      ) : null}
    </p>
  );
}

/**
 * Admin: the things that need a look, before any figures. Whether picks are being sent to bet (the master switch),
 * how many strategies are Live, sent picks Betfair has no bet for, and picks still waiting for a result.
 */
function StatusStrip({ pending }: { pending: number }) {
  const sending = useSending(60_000);
  const unplaced = useUnplaced();
  const s = sending.data;
  if (!s) return <Skeleton className="h-8 w-72" />;
  const on = s.settings.enabled;
  const live = s.strategies.filter((x) => x.enabled).length;
  const notPlaced = unplaced.data?.configured ? unplaced.data.picks.length : null;
  const pill = "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium";
  return (
    <nav aria-label="Status" className="flex flex-wrap gap-2">
      <Link href="/more/admin/sending" className={`${pill} ${on ? "border-line text-ink" : "border-warn/40 bg-warn/10 text-warn"}`}>
        <span aria-hidden className={`h-2 w-2 rounded-full ${on ? "bg-hit" : "bg-warn"}`} />
        Sending {on ? "on" : "off"}
      </Link>
      <Link href="/more/admin/sending" className={`${pill} border-line text-ink`} title="Strategies whose picks are sent to bet">
        {live} Live
      </Link>
      {notPlaced !== null && (
        <Link
          href="/more/admin/sending"
          className={`${pill} ${notPlaced > 0 ? "border-warn/40 bg-warn/10 text-warn" : "border-line text-ink-muted"}`}
        >
          {notPlaced} not placed
        </Link>
      )}
      <Link href="/live" className={`${pill} border-line ${pending > 0 ? "text-ink" : "text-ink-muted"}`} title="Picks still waiting for a result">
        {pending} waiting
      </Link>
    </nav>
  );
}

function HeroSkeleton() {
  return (
    <div className="space-y-4">
      <div>
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-2 h-11 w-40" />
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-6 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
