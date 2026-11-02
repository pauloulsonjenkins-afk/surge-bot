"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader, Segmented } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { useAdminStrategies, useStrategyWeeks, type AdminStrategy } from "@/queries/use-strategies";
import { useIsArchived } from "@/queries/use-archive";
import { useStrategyNames } from "@/queries/use-strategy-names";
import { useToday } from "@/queries/use-today";
import { AdviceRow, ApplyAllAdvice, adviceTitle } from "@/components/admin/Advice";
import { trendOf } from "@/components/admin/StrategyWeekly";
import { isLayRow } from "@/components/admin/LaySection";
import { ownMode } from "@/components/admin/strategies/strategy-parts";
import { gbp, units as formatUnits } from "@/lib/format";
import { strategyHref } from "../strategies/page";

type Kind = "daily" | "weekly";

/**
 * Daily and weekly report (2 Nov 2026): what changed and what to do about it, with each suggestion adoptable here and now.
 * The suggestions are the engine's own (the same ones as on Strategies); nothing changes until one is pressed and confirmed.
 */
export default function ReportsPage() {
  const [kind, setKind] = useState<Kind>("daily");
  const { data, isLoading, error } = useAdminStrategies(null);
  const weeks = useStrategyWeeks();
  const today = useToday();
  const names = useStrategyNames();
  const isArchived = useIsArchived();
  const advice = useMemo(() => today.data?.advice ?? [], [today.data]);
  const rows = useMemo(() => (data?.strategies ?? []).filter((r) => !isArchived(r.label) && !isLayRow(r)), [data, isArchived]);

  if (error) return <QueryError error={error} next="/more/admin/reports" />;
  if (isLoading || !data) return <Skeleton className="h-64 w-full" />;

  // Today so far, Live and Sim apart, across every strategy.
  const sum = (m: "live" | "sim") => rows.reduce((a, r) => a + (r.today?.[m]?.profit ?? 0), 0);
  const bets = (m: "live" | "sim") => rows.reduce((a, r) => a + (r.today?.[m]?.counted ?? 0), 0);

  const moves = rows
    .map((r) => {
      const w = weeks.data?.strategies[r.label.toLowerCase()];
      const m = ownMode(r).mode;
      return w ? { r, m, last7: w.last7[m], prev28: w.prev28[m], trend: trendOf(w.last7[m], w.prev28[m]) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && x.last7.counted > 0)
    .sort((a, b) => (b.last7.units ?? 0) - (a.last7.units ?? 0));
  const all = weeks.data?.strategies["__all__"];

  const row = (x: { r: AdminStrategy; m: "live" | "sim"; last7: { units?: number; counted: number }; prev28: { units?: number; counted: number }; trend: { label: string; cls: string } }) => (
    <li key={x.r.label}>
      <Link href={strategyHref(x.r.label)} className="flex min-h-12 items-center gap-3 border-t border-line px-3.5 py-2 first:border-t-0">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{names.name(x.r.label)}</span>
          <span className="text-xs text-ink-muted">{x.m === "live" ? "Live" : "Sim"} · before: {formatUnits(x.prev28.units ?? 0)} ({x.prev28.counted})</span>
        </span>
        <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${x.trend.cls}`}>{x.trend.label}</span>
        <span className={`w-16 shrink-0 text-right text-sm font-medium tabular-nums ${(x.last7.units ?? 0) > 0 ? "text-hit" : (x.last7.units ?? 0) < 0 ? "text-loss" : "text-ink"}`}>{formatUnits(x.last7.units ?? 0)}</span>
      </Link>
    </li>
  );

  return (
    <div className="space-y-4">
      <PageHeader as="h2" title="Report" subtitle="What changed and what to do about it. Each suggestion can be adopted here; nothing changes until you press the button and confirm." />
      <Segmented label="Report" value={kind} onChange={setKind} options={[{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }]} />

      {kind === "daily" ? (
        <section className="rounded-xl border border-line bg-surface p-3.5">
          <h3 className="text-sm font-semibold text-ink">Today so far</h3>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-surface-2 p-3">
              <p className="text-xs text-ink-muted">Live</p>
              <p className="text-lg font-medium tabular-nums">{gbp(sum("live"))}</p>
              <p className="text-xs text-ink-muted">{bets("live")} bets</p>
            </div>
            <div className="rounded-lg bg-surface-2 p-3">
              <p className="text-xs text-ink-muted">Sim</p>
              <p className="text-lg font-medium tabular-nums">{gbp(sum("sim"))}</p>
              <p className="text-xs text-ink-muted">{bets("sim")} bets</p>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-line bg-surface p-3.5">
          <h3 className="text-sm font-semibold text-ink">The last 7 days, strategy by strategy</h3>
          <p className="mt-0.5 text-xs text-ink-muted">Units: profit at a flat 1 unit per bet. The right-hand figure is the last 7 days; &ldquo;before&rdquo; is the 4 weeks earlier.</p>
          {all && (
            <p className="mt-2 text-sm text-ink">
              All strategies: <span className="font-medium tabular-nums">{formatUnits(all.last7.all.units ?? 0)}</span> over {all.last7.all.counted} bets, against {formatUnits(all.prev28.all.units ?? 0)} over {all.prev28.all.counted} in the 4 weeks before.
            </p>
          )}
          {moves.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">No settled bets in the last 7 days yet.</p>
          ) : (
            <ul className="mt-2 overflow-hidden rounded-lg border border-line">
              {moves.map(row)}
            </ul>
          )}
        </section>
      )}

      <section className="rounded-xl border-2 border-accent bg-accent/5 p-3.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          Suggestions
          <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-accent-ink">{advice.length}</span>
        </h3>
        {advice.length === 0 ? (
          <p className="mt-1 text-sm text-ink-muted">Nothing to change today.</p>
        ) : (
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
      </section>
    </div>
  );
}
