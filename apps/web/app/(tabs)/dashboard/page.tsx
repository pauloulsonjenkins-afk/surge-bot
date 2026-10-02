"use client";

import { Card, PageHeader, Segmented } from "@/components/ui/Card";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Lock } from "lucide-react";
import { useHitRateStats, type HitRateStats } from "@/queries/use-stats";
import { usePerformanceCells } from "@/queries/use-performance";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { HeroRow } from "@/components/dashboard/SummaryCards";
import { TIMEFRAMES, TimeframeToggle, type Timeframe } from "@/components/dashboard/TimeframeToggle";
import { DailyResultsChart } from "@/components/dashboard/DailyResultsChart";
import { HitRateTrendChart } from "@/components/dashboard/HitRateTrendChart";
import { RateBarChart } from "@/components/dashboard/RateBarChart";
import { PerformanceSection } from "@/components/dashboard/PerformanceSection";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { ModeToggle, usePickMode } from "@/components/ui/ModeToggle";
import { useMe } from "@/queries/use-me";

/**
 * The breakdowns from the plain hit-rate stats, used until the per-league performance figures have loaded
 * (or when the engine doesn't send them). Same tabs as the full version.
 */
function SimpleBreakdown({ stats, isLoading }: { stats: HitRateStats | undefined; isLoading: boolean }) {
  const [tab, setTab] = useState<"strategy" | "minute" | "league">("strategy");
  // Leagues with nothing settled are left out of the chart; the busiest eight are shown.
  const leagues = (stats?.byLeague ?? []).filter((l) => l.hits + l.misses > 0).slice(0, 8);
  const strategies = (stats?.byStrategy ?? []).filter((s) => s.hits + s.misses > 0);

  return (
    <Card
      title="Breakdown"
      subtitle={
        tab === "strategy"
          ? "Hit rate from settled picks"
          : tab === "minute"
            ? "Hit rate by the match minute the alert fired"
            : "Busiest leagues first"
      }
    >
      <Segmented
        label="Break down by"
        value={tab}
        onChange={setTab}
        className="mb-4"
        options={[
          { value: "strategy", label: "Strategy" },
          { value: "minute", label: "Minute" },
          { value: "league", label: "League" },
        ]}
      />
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : tab === "strategy" ? (
        <RateBarChart rows={strategies} layout="bars" emptyDetail="Strategies appear once picks settle." />
      ) : tab === "minute" ? (
        <RateBarChart rows={stats?.byMinute ?? []} layout="columns" emptyDetail="Minute breakdown appears once picks settle." />
      ) : (
        <RateBarChart rows={leagues} layout="bars" emptyDetail="Leagues appear once picks settle." />
      )}
    </Card>
  );
}

export default function DashboardPage() {
  const [timeframe, setTimeframe] = useState<Timeframe>("7D");
  const days = TIMEFRAMES.find((t) => t.value === timeframe)?.days ?? null;
  const [strategy, setStrategy] = useState<string | null>(null);
  const mode = usePickMode();
  const { data: me } = useMe();
  const { data, isLoading, error } = useHitRateStats(days, strategy, mode);
  const performance = usePerformanceCells(days, mode);
  const performanceCells = performance.data ?? [];

  return (
    <div className="space-y-8 px-4 py-4">
      <div className="space-y-4">
        {/* The GoalBrew logo on phones and tablets; wide screens show it at the top of the sidebar. */}
        <div className="lg:hidden">
          <Image unoptimized priority src="/brand/goalbrew-logo-dark.svg" alt="GoalBrew" width={168} height={28} className="h-7 w-auto [[data-theme=light]_&]:hidden" />
          <Image unoptimized src="/brand/goalbrew-logo-light.svg" alt="GoalBrew" width={168} height={28} className="hidden h-7 w-auto [[data-theme=light]_&]:block" />
        </div>
        <PageHeader
          title="Dashboard"
          actions={
            <>
              <span className="lg:hidden">
                <ThemeToggle />
              </span>
              {/* Signed out: the way into the admin area. Once signed in as admin, phones get it here too; wide screens list the admin pages in the sidebar. */}
              {me && (
                <Link
                  href={me.admin ? "/more/admin/sending" : "/more/admin/login"}
                  className={`flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink-muted hover:text-ink ${me.admin ? "lg:hidden" : ""}`}
                >
                  <Lock size={13} />
                  {me.admin ? "Admin" : "Admin sign in"}
                </Link>
              )}
            </>
          }
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <TimeframeToggle value={timeframe} onChange={setTimeframe} />
          <ModeToggle />
          {strategy && (
            <span className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="rounded-full bg-accent/15 px-2.5 py-0.5 font-medium text-ink">{strategy}</span>
              <button type="button" onClick={() => setStrategy(null)} className="text-ink-muted underline">
                Show all
              </button>
            </span>
          )}
        </div>

        {!error && <HeroRow stats={data} isLoading={isLoading} timeframe={timeframe} strategy={strategy} mode={mode} />}
      </div>

      {error ? (
        <QueryError error={error} next="/dashboard" />
      ) : (
        <>
          <DailyResultsChart stats={data} isLoading={isLoading} />
          <HitRateTrendChart stats={data} isLoading={isLoading} />

          {performanceCells.length > 0 ? (
            <PerformanceSection key={`${days ?? "all"}:${mode}`} cells={performanceCells} strategy={strategy} onStrategyChange={setStrategy} />
          ) : (
            <SimpleBreakdown stats={data} isLoading={isLoading} />
          )}
        </>
      )}
    </div>
  );
}
