import { DashboardSummary } from "@/domain/dashboard";
import { formatCurrency, formatNumber, formatRatio } from "@/lib/format";
import { TrendChip } from "@/components/ui/TrendChip";
import { Skeleton } from "@/components/ui/Skeleton";

function Card({
  label,
  value,
  sub,
  trend,
}: {
  label: string;
  value: string;
  sub: string;
  trend?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-muted">{label}</p>
        {trend}
      </div>
      <p className="mt-1.5 text-xl font-medium tabular-nums tracking-tight text-ink">{value}</p>
      <p className="mt-0.5 text-[11px] text-ink-muted">{sub}</p>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-2 h-6 w-20" />
      <Skeleton className="mt-2 h-3 w-24" />
    </div>
  );
}

export function SummaryCards({
  summary,
  isLoading,
}: {
  summary: DashboardSummary | undefined;
  isLoading: boolean;
}) {
  if (isLoading || !summary) {
    return (
      <div className="grid grid-cols-2 gap-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    );
  }

  const { totalPoints, cumulativePnl, winLossRatio, activeExposure } = summary;

  return (
    <div className="grid grid-cols-2 gap-2.5">
      <Card
        label="Total Points"
        value={formatNumber(totalPoints.value)}
        sub="vs prior period"
        trend={<TrendChip changePct={totalPoints.changePct} />}
      />
      <Card
        label="Cumulative P&L"
        value={formatCurrency(cumulativePnl.value, true)}
        sub="vs prior period"
        trend={<TrendChip changePct={cumulativePnl.changePct} />}
      />
      <Card
        label="Win/Loss Ratio"
        value={formatRatio(winLossRatio.value)}
        sub={`${winLossRatio.wins}W – ${winLossRatio.losses}L`}
        trend={<TrendChip changePct={winLossRatio.changePct} />}
      />
      <Card
        label="Active Exposure"
        value={formatCurrency(activeExposure.value)}
        sub={`${activeExposure.openPositions} open position${activeExposure.openPositions === 1 ? "" : "s"} · live`}
      />
    </div>
  );
}
