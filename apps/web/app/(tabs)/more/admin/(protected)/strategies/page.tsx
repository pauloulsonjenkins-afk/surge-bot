"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { useAdminStrategies, type AdminStrategy } from "@/queries/use-strategies";
import { useGolden } from "@/queries/use-golden";
import { useIsArchived } from "@/queries/use-archive";
import { useStrategyNames } from "@/queries/use-strategy-names";
import { useToday } from "@/queries/use-today";
import { AdviceRow, ApplyAllAdvice, adviceTitle, IgnoredAdvice } from "@/components/admin/Advice";
import { isLayRow } from "@/components/admin/LaySection";
import { INACTIVE_DAYS, modeOf } from "@/components/admin/strategies/strategy-parts";
import { byMoney, disagrees, ENOUGH, LEVEL_BAND, signedGbp, totalOf, VERDICT_WORDS, verdictOf, type MoneyLine, type Verdict } from "@/lib/money-verdict";
import type { StrategyAdvice } from "@/server/engine-client";

/** The address of a strategy's own page. */
export const strategyHref = (label: string) => `/more/admin/strategies/${encodeURIComponent(label.toLowerCase())}`;

/** Real bets a strategy needs on trial before its earlier real-money record is mentioned. */
const EARLIER_FROM = 20;

const TONE: Record<Verdict, string> = { making: "text-hit", losing: "text-loss", level: "text-ink", early: "text-ink-muted", none: "text-ink-muted" };
const CHIP: Record<Verdict, string> = { making: "bg-hit/15 text-hit", losing: "bg-loss/15 text-loss", level: "bg-ink/10 text-ink", early: "bg-ink/5 text-ink-muted", none: "bg-ink/5 text-ink-muted" };

/**
 * Strategies, stripped back (owner, 21 Nov 2026). Two lists that never mix: Real money (real £ only, including Golden
 * slices that bet real money inside a strategy that is otherwise on trial) and On trial (pretend bets only). One £
 * figure and one plain label each (src/lib/money-verdict.ts). The detail is a tap away, on each strategy's own page.
 */
export default function StrategiesPage() {
  const { data, isLoading, error } = useAdminStrategies(null);
  const golden = useGolden();
  const today = useToday();
  const names = useStrategyNames();
  const isArchived = useIsArchived();
  const [loadedAt] = useState(() => Date.now());

  const advice = useMemo<StrategyAdvice[]>(() => today.data?.advice ?? [], [today.data]);
  const readyKeys = useMemo(() => new Set(advice.filter((a) => a.kind === "try-live").map((a) => a.key.toLowerCase())), [advice]);

  if (error) return <QueryError error={error} next="/more/admin/strategies" />;
  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const shown = data.strategies.filter((r) => !isArchived(r.label) && !r.mergedInto);
  const isQuiet = (r: AdminStrategy) => !r.sendingOn && (!r.lastAlertAt || loadedAt - Date.parse(r.lastAlertAt) > INACTIVE_DAYS * 86_400_000);

  // Real money: Live strategies, on their real bets only.
  // Every strategy betting real money is listed, even one folded into another for reporting (a merged one: the old
  // "Telegram: TipMan InPlays & Rollers" was Live and missing from the list, 21 Nov 2026).
  const realLines: MoneyLine[] = data.strategies
    .filter((r) => !isArchived(r.label) && (!r.mergedInto || modeOf(r) === "live"))
    .filter((r) => modeOf(r) === "live")
    .map((r) => {
      const live = r.returns?.live;
      const profit = live?.profit ?? 0;
      const bets = live?.counted ?? 0;
      return { key: r.label, name: names.name(r.label), profit, bets, verdict: verdictOf(profit, bets, live?.staked), lay: isLayRow(r) };
    });
  // ...and Golden slices betting real money inside a strategy that is otherwise on trial (it used to look like Sim).
  const liveLabels = new Set(realLines.map((l) => l.key.toLowerCase()));
  for (const s of golden.data?.slices ?? []) {
    if (!s.bet?.live || liveLabels.has(s.strategyKey)) continue;
    const profit = s.ownLive?.profit ?? s.slice.live.profit ?? 0;
    const bets = s.ownLive?.n ?? s.slice.live.counted ?? 0;
    const parent = shown.find((r) => r.label.toLowerCase() === s.strategyKey)?.label ?? s.strategy;
    realLines.push({ key: `${parent}#${s.id}`, name: names.name(parent), detail: `Only: ${s.label.replace(/^Golden:\s*/, "")}`, profit, bets, verdict: verdictOf(profit, bets, s.ownLive?.staked ?? s.slice.live.staked) });
  }
  realLines.sort(byMoney);

  // On trial: pretend bets only.
  const trialLine = (r: AdminStrategy): MoneyLine => {
    const sim = r.returns?.sim;
    const live = r.returns?.live;
    const profit = sim?.profit ?? 0;
    const bets = sim?.counted ?? 0;
    return {
      key: r.label,
      name: names.name(r.label),
      profit,
      bets,
      verdict: verdictOf(profit, bets, sim?.staked),
      lay: isLayRow(r),
      ready: readyKeys.has(r.label.toLowerCase()),
      earlierReal: live && live.counted >= EARLIER_FROM ? { profit: live.profit, bets: live.counted } : null,
      disagree: !!live && live.counted >= EARLIER_FROM && disagrees(profit, live.profit),
    };
  };
  const onTrial = shown.filter((r) => modeOf(r) === "sim" && !isQuiet(r));
  const trialLines = onTrial.filter((r) => !isLayRow(r)).map(trialLine).sort(byMoney);
  const trialLays = onTrial.filter((r) => isLayRow(r)).map(trialLine).sort(byMoney);
  const quietLines = shown.filter((r) => modeOf(r) === "sim" && isQuiet(r)).map(trialLine).sort(byMoney);

  const trialMain = trialLines.filter((l) => l.verdict !== "losing");
  const trialLosing = trialLines.filter((l) => l.verdict === "losing");
  const real = totalOf(realLines);

  const row = (l: MoneyLine, kind: "real" | "trial") => (
    <li key={l.key}>
      <Link href={strategyHref(l.key.split("#")[0]!)} className="flex min-h-14 items-center gap-3 border-t border-line px-3.5 py-2.5 first:border-t-0">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{l.name}</span>
          {l.detail && <span className="block truncate text-xs text-ink-muted">{l.detail}</span>}
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
            <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${CHIP[l.verdict]}`}>{VERDICT_WORDS[kind][l.verdict]}</span>
            {l.bets > 0 && (
              <span>
                {l.bets} {kind === "real" ? "real" : "trial"} {l.bets === 1 ? "bet" : "bets"} in total
              </span>
            )}
            {l.lay && <span>· lay</span>}
            {l.ready && <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[11px] font-medium text-accent">Ready for real money</span>}
          </span>
          {l.earlierReal && (
            <span className={`mt-0.5 block text-xs ${l.disagree ? "font-medium text-warn" : "text-ink-muted"}`}>
              {l.disagree
                ? `With real money it did the opposite: ${signedGbp(l.earlierReal.profit)} over ${l.earlierReal.bets} bets. Trust the real result.`
                : `Earlier with real money: ${signedGbp(l.earlierReal.profit)} over ${l.earlierReal.bets} bets`}
            </span>
          )}
        </span>
        <span className={`shrink-0 text-right text-base font-semibold tabular-nums ${TONE[l.verdict]}`}>{l.bets > 0 ? signedGbp(l.profit) : "–"}</span>
        <ChevronRight size={16} aria-hidden className="shrink-0 text-ink-muted" />
      </Link>
    </li>
  );

  const list = (lines: MoneyLine[], kind: "real" | "trial") => <ul className="overflow-hidden rounded-xl border border-line bg-surface">{lines.map((l) => row(l, kind))}</ul>;
  const folded = (title: string, note: string, lines: MoneyLine[]) =>
    lines.length === 0 ? null : (
      <details className="space-y-2">
        <summary className="cursor-pointer text-sm font-medium text-ink">
          {title} <span className="font-normal text-ink-muted">· {lines.length}</span>
        </summary>
        <p className="mt-1 text-xs text-ink-muted">{note}</p>
        <div className="mt-2">{list(lines, "trial")}</div>
      </details>
    );

  return (
    <div className="space-y-6">
      <PageHeader as="h2" title="Strategies" subtitle="Is each one making or losing money?" />

      <section className="space-y-2" aria-label="Real money">
        <div>
          <h3 className="text-base font-semibold text-ink">
            Real money <span className="text-sm font-normal text-ink-muted">· {realLines.length}</span>
          </h3>
          <p className="text-xs text-ink-muted">Real bets on Betfair, in total since each started: not just today. Only real results are shown here.</p>
        </div>
        {realLines.length > 0 ? (
          <>
            <div className="flex items-baseline justify-between rounded-xl border border-line bg-surface px-3.5 py-3">
              <span className="text-sm text-ink">
                Together, all their real bets so far
                <span className="block text-xs text-ink-muted">{real.bets} bets</span>
              </span>
              <span className={`text-xl font-semibold tabular-nums ${real.profit > 0 ? "text-hit" : real.profit < 0 ? "text-loss" : "text-ink"}`}>{signedGbp(real.profit)}</span>
            </div>
            {list(realLines, "real")}
          </>
        ) : (
          <p className="text-sm text-ink-muted">Nothing is betting real money.</p>
        )}
      </section>

      <section className="space-y-2" aria-label="On trial">
        <div>
          <h3 className="text-base font-semibold text-ink">
            On trial <span className="text-sm font-normal text-ink-muted">· {trialMain.length}</span>
          </h3>
          <p className="text-xs text-ink-muted">Pretend bets, in total since each started: what it would have made. No money is placed.</p>
        </div>
        {trialMain.length > 0 ? list(trialMain, "trial") : <p className="text-sm text-ink-muted">Nothing on trial is ahead or new.</p>}
        {folded("Losing on trial", `Losing over ${ENOUGH}+ pretend bets. Still recorded, in case they turn.`, trialLosing)}
        {folded("Lay strategies on trial", "Laying instead of backing, on pretend bets.", trialLays)}
        {folded("Quiet", `No alerts for ${INACTIVE_DAYS}+ days. They move to the Archive after 30.`, quietLines)}
      </section>

      {advice.length > 0 && (
        <section aria-label="Suggestions" className="rounded-xl border border-line bg-surface p-3.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            Suggestions
            <span className="rounded-full bg-warn/15 px-2 py-0.5 text-xs font-bold text-warn">{advice.length}</span>
          </h3>
          <div className="mt-2">
            <ApplyAllAdvice advice={advice} nameOf={(a) => adviceTitle(a, names.name)} />
          </div>
          <ul className="mt-3 space-y-3 text-sm">
            {advice.map((a) => (
              <AdviceRow key={`${a.key}:${a.kind}:${a.league?.key ?? ""}:${a.name ?? ""}`} a={a} name={adviceTitle(a, names.name)} link={!!a.league} />
            ))}
          </ul>
        </section>
      )}
      <IgnoredAdvice nameOf={(a) => adviceTitle(a, names.name)} />

      <p className="text-xs text-ink-muted">
        A label needs {ENOUGH}+ bets: before that it is too early to tell, however good or bad the £ looks. Within {Math.round(LEVEL_BAND * 100)}% of the money staked either way counts as around break-even. Real and trial results often disagree at these sizes: when they do, trust the real one. Tap a strategy for its detail, or see{" "}
        <Link href="/more/admin/strategies/all" className="text-accent underline underline-offset-2">
          Full detail
        </Link>
        .
      </p>
    </div>
  );
}
