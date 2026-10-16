"use client";

import { useState } from "react";
import type { PickMode } from "@/server/engine-client";
import { WinLossLines } from "@/components/admin/WinLossLines";
import { Segmented } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { gbp } from "@/lib/format";
import { ChartCard } from "./ChartCard";
import { EmptyState } from "./EmptyState";
import { useDashboardWinLoss } from "./WinLossSummary";

type Range = "d7" | "d30" | "ytd";
const RANGES: Array<{ value: Range; label: string }> = [
  { value: "d7", label: "7D" },
  { value: "d30", label: "30D" },
  { value: "ytd", label: "YTD" },
];
const WORDS: Record<Range, string> = { d7: "the last 7 days", d30: "the last 30 days", ytd: "this year" };

const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Admin: profit and loss in £, built up day by day over 7 days, 30 days or the year to date (UK days), priced exactly
 * as the Profit page. Follows the Dashboard's Live / Sim / All switch and its strategy filter. Before running costs.
 */
export function ProfitPeriodChart({ mode, strategy }: { mode: PickMode; strategy: string | null }) {
  const [range, setRange] = useState<Range>("d7");
  const winLoss = useDashboardWinLoss(mode);
  const key = strategy?.toLowerCase() ?? null;
  const points = winLoss.data?.series[range] ?? [];
  const data = points.map((p) => ({ label: shortDate(p.label), total: key === null ? p.total : (p.s[key] ?? 0) }));
  const last = data.at(-1)?.total ?? 0;
  const color = last > 0 ? "var(--hit)" : last < 0 ? "var(--loss)" : "var(--chart)";
  const missing = range === "d30" && winLoss.data && !winLoss.data.series.d30;

  return (
    <ChartCard
      title="Profit and loss"
      subtitle={`Running total in £ over ${WORDS[range]}, day by day${data.length > 1 ? `: ${gbp(last)}` : ""}`}
      actions={<Segmented label="Profit period" value={range} onChange={setRange} options={RANGES} />}
    >
      {winLoss.isLoading ? (
        <Skeleton className="h-56 w-full" />
      ) : missing ? (
        <EmptyState title="Not available yet" detail="The 30-day view appears once the engine has updated." />
      ) : data.length < 2 || points.every((p) => p.total === 0) ? (
        <EmptyState title="Nothing settled in this period" detail="The line starts with the first settled pick." />
      ) : (
        <WinLossLines data={data} series={[{ key: "total", name: "Profit", color }]} />
      )}
    </ChartCard>
  );
}
