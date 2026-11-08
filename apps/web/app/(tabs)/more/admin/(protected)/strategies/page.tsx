"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { useAdminStrategies, useStrategyWeeks, type AdminStrategy } from "@/queries/use-strategies";
import { useIsArchived } from "@/queries/use-archive";
import { useStrategyNames } from "@/queries/use-strategy-names";
import { useToday } from "@/queries/use-today";
import { AdviceRow, ApplyAllAdvice, adviceTitle, ADVICE_LABEL, isGoodAdvice } from "@/components/admin/Advice";
import { trendOf } from "@/components/admin/StrategyWeekly";
import { isLayRow } from "@/components/admin/LaySection";
import { GoldenSlicesSection } from "@/components/admin/strategies/GoldenSlicesSection";
import { INACTIVE_DAYS, SAMPLE, adjustedRoi, modeOf, ownMode, returnsFor, roiTone } from "@/components/admin/strategies/strategy-parts";
import { roiText } from "@/lib/hit-rate";
import type { StrategyAdvice } from "@/server/engine-client";

/** Below this many priced bets a return isn't shown on the overview. */
const MIN_SHOWN = 10;

/** The address of a strategy's own page. */
export const strategyHref = (label: string) => `/more/admin/strategies/${encodeURIComponent(label.toLowerCase())}`;

/**
 * Strategies (redesigned 2 Nov 2026): one short line per strategy, with what needs a look at the top, and a page of its own
 * for each (tap a line). The old everything-on-one-page view is still there, under "Full detail".
 */
export default function StrategiesPage() {
  const { data, isLoading, error } = useAdminStrategies(null);
  const weeks = useStrategyWeeks();
  const today = useToday();
  const names = useStrategyNames();
  const isArchived = useIsArchived();
  const [loadedAt] = useState(() => Date.now());

  const advice = useMemo<StrategyAdvice[]>(() => today.data?.advice ?? [], [today.data]);
  const adviceOf = useMemo(() => new Map(advice.filter((a) => a.kind !== "league-block" && !a.kind.startsWith("slice")).map((a) => [a.key.toLowerCase(), a])), [advice]);
  const strategies = useMemo(() => (data?.strategies ?? []).filter((r) => !isArchived(r.label) && !isLayRow(r)), [data, isArchived]);
  const layCount = (data?.strategies ?? []).filter((r) => !isArchived(r.label) && isLayRow(r)).length;

  if (error) return <QueryError error={error} next="/more/admin/strategies" />;
  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const isInactive = (r: AdminStrategy) => !r.sendingOn && (!r.lastAlertAt || loadedAt - Date.parse(r.lastAlertAt) > INACTIVE_DAYS * 86_400_000);
  const isParked = (r: AdminStrategy) => {
    const sim = r.returns?.sim;
    if (r.sendingOn || !sim || sim.counted < SAMPLE) return false;
    const adj = adjustedRoi(sim.roi, sim.counted);
    return adj !== null && adj < -0.02;
  };
  const trendFor = (r: AdminStrategy) => {
    const w = weeks.data?.strategies[r.label.toLowerCase()];
    if (!w) return null;
    const m = ownMode(r).mode;
    return trendOf(w.last7[m], w.prev28[m]);
  };
  /** Sim strategies whose last 7 days have turned up after a flat or losing month: the early-curve ones to look at. */
  const warming = strategies.filter((r) => modeOf(r) === "sim" && !isInactive(r) && !adviceOf.has(r.label.toLowerCase()) && trendFor(r)?.label === "Turning up");

  const live = strategies.filter((r) => modeOf(r) === "live" && !isInactive(r));
  const quiet = strategies.filter((r) => isInactive(r));
  const parked = strategies.filter((r) => modeOf(r) === "sim" && !isInactive(r) && isParked(r));
  const testing = strategies.filter((r) => modeOf(r) === "sim" && !isInactive(r) && !isParked(r));
  const byReturn = (a: AdminStrategy, b: AdminStrategy) => (adjustedRoi(returnsFor(b, ownMode(b).mode)?.roi ?? null, returnsFor(b, ownMode(b).mode)?.counted ?? 0) ?? -9) - (adjustedRoi(returnsFor(a, ownMode(a).mode)?.roi ?? null, returnsFor(a, ownMode(a).mode)?.counted ?? 0) ?? -9);

  const line = (r: AdminStrategy) => {
    const mode = ownMode(r).mode;
    const money = returnsFor(r, mode);
    const trend = trendFor(r);
    const a = adviceOf.get(r.label.toLowerCase());
    const showTrend = trend && trend.label !== "Too few bets" && trend.label !== "Level";
    return (
      <li key={r.label}>
        <Link href={strategyHref(r.label)} className="flex min-h-14 items-center gap-3 border-t border-line px-3.5 py-2.5 first:border-t-0">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">{names.name(r.label)}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
              {/* The strategy's real state, which is where it is listed; the figures may come from its other side (past Live bets). */}
              <span>{modeOf(r) === "live" ? "Live" : "Sim"}</span>
              <span>
                · {money?.counted ?? 0} {money?.counted === 1 ? "bet" : "bets"}
                {modeOf(r) !== mode ? ` (${mode === "live" ? "Live" : "Sim"} bets)` : ""}
              </span>
              {showTrend && <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${trend.cls}`}>{trend.label}</span>}
              {a && <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${isGoodAdvice(a) ? "bg-hit/15 text-hit" : "bg-warn/20 text-warn"}`}>{ADVICE_LABEL[a.kind]}</span>}
            </span>
          </span>
          {/* A return from a handful of bets means nothing (2 bets read +352%), so it is greyed and marked until there are enough. */}
          {money && money.counted >= MIN_SHOWN ? (
            <span className={`shrink-0 text-sm font-medium tabular-nums ${roiTone(money.roi)}`}>{roiText(money.roi)}</span>
          ) : (
            <span className="shrink-0 text-xs text-ink-muted">{money && money.counted > 0 ? "too few" : "–"}</span>
          )}
          <ChevronRight size={16} aria-hidden className="shrink-0 text-ink-muted" />
        </Link>
      </li>
    );
  };

  const group = (title: string, note: string | undefined, rows: AdminStrategy[], folded = false) => {
    if (rows.length === 0) return null;
    const list = <ul className="overflow-hidden rounded-xl border border-line bg-surface">{[...rows].sort(byReturn).map(line)}</ul>;
    return folded ? (
      <details className="space-y-2">
        <summary className="cursor-pointer text-sm font-medium text-ink">
          {title} <span className="font-normal text-ink-muted">· {rows.length}</span>
        </summary>
        {note && <p className="mt-1 text-xs text-ink-muted">{note}</p>}
        <div className="mt-2">{list}</div>
      </details>
    ) : (
      <section className="space-y-2">
        <div>
          <h3 className="text-base font-semibold text-ink">
            {title} <span className="text-sm font-normal text-ink-muted">· {rows.length}</span>
          </h3>
          {note && <p className="text-xs text-ink-muted">{note}</p>}
        </div>
        {list}
      </section>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader as="h2" title="Strategies" subtitle="Return per £1 on each strategy's own bets." />

      <nav className="flex flex-wrap gap-2 text-xs font-medium" aria-label="Related pages">
        <Link href="/more/admin/reports" className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-ink">Daily and weekly report</Link>
        <Link href="/more/admin/strategies/all" className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-ink">Full detail{layCount > 0 ? ` and LAY bets (${layCount})` : ""}</Link>
        <Link href="/more/admin/archive" className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-ink">Archive</Link>
      </nav>

      {(advice.length > 0 || warming.length > 0) && (
        <section aria-label="Needs a look" className="rounded-xl border border-line bg-surface p-3.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            Needs a look
            <span className="rounded-full bg-warn/15 px-2 py-0.5 text-xs font-bold text-warn">{advice.length + warming.length}</span>
          </h3>
          {advice.length > 0 && (
            <>
              <div className="mt-2">
                <ApplyAllAdvice advice={advice} nameOf={(a) => adviceTitle(a, names.name)} />
              </div>
              <ul className="mt-3 space-y-3 text-sm">
                {advice.map((a) => (
                  <AdviceRow key={`${a.key}:${a.kind}:${a.league?.key ?? ""}:${a.name ?? ""}`} a={a} name={adviceTitle(a, names.name)} link={!!a.league} />
                ))}
              </ul>
            </>
          )}
          {warming.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-ink">Turning up in Sim: its last 7 days are better than the 4 weeks before</p>
              <ul className="mt-1 overflow-hidden rounded-lg border border-line bg-surface">
                {warming.map(line)}
              </ul>
            </div>
          )}
        </section>
      )}

      {strategies.length === 0 ? (
        <p className="text-sm text-ink-muted">Strategies appear here once alerts arrive.</p>
      ) : (
        <>
          {group("Live", "Bet with real money.", live)}
          {group("Testing in Sim", "Recorded as if bet; no money placed.", testing)}
          {group("Losing in Sim", "Clearly losing over 50+ bets. Still recorded, and they come back up the list by themselves if they turn.", parked, true)}
          {group("Quiet", `No alerts for ${INACTIVE_DAYS}+ days. They move to the Archive after 30.`, quiet, true)}
        </>
      )}

      <details className="space-y-2">
        <summary className="cursor-pointer text-sm font-medium text-ink">Golden slices <span className="font-normal text-ink-muted">· parts of a strategy you can put Live on their own</span></summary>
        <div className="mt-2">
          <GoldenSlicesSection />
        </div>
      </details>
    </div>
  );
}
