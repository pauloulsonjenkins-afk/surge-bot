"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { useQuery } from "@tanstack/react-query";
import type { WinLossState } from "@/queries/use-winloss";
import { getJson } from "@/queries/fetch-json";
import { gbp } from "@/components/admin/WinLossLines";

function Amount({ value }: { value: number }) {
  const tone = value > 0 ? "text-hit" : value < 0 ? "text-danger" : "text-ink-muted";
  return <span className={`text-2xl font-medium tabular-nums ${tone}`}>{value === 0 ? "£0.00" : gbp(value)}</span>;
}

/**
 * Win / loss in pounds for the last 7 days and the month so far. Money figures are private, so this only
 * appears for a signed-in admin: for anyone else the request is refused and the card simply isn't there.
 * When the Dashboard is filtered to one strategy, it shows that strategy's figures instead of the overall ones.
 */
export function WinLossSummary({ strategy }: { strategy: string | null }) {
  const { data } = useQuery({
    queryKey: ["winloss"],
    queryFn: ({ signal }) => getJson<WinLossState>("/api/admin/winloss", "the win/loss figures", signal),
    retry: false, // a signed-out visitor is refused once, not three times
    staleTime: 0,
    refetchInterval: 30_000,
  });
  if (!data) return null;

  const key = strategy?.toLowerCase() ?? null;
  const pick = (p: "d7" | "mtd"): number => (key === null ? data.periods[p].total : (data.periods[p].strategies[key] ?? 0));
  const showCost = key === null && data.settings.expenditure.enabled && data.periods.mtd.expenditure > 0;

  return (
    <Card
      title="Win / loss"
      subtitle={`${strategy ?? "All strategies"} · estimate from alert odds`}
      actions={
        <Link href="/more/admin/winloss" className="text-xs text-ink-muted underline">
          Details
        </Link>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-ink-muted">Last 7 days</p>
          <Amount value={pick("d7")} />
        </div>
        <div>
          <p className="text-xs text-ink-muted">Month to date</p>
          <Amount value={pick("mtd")} />
          {showCost && (
            <p className="mt-0.5 text-[11px] text-ink-muted">
              <span className="tabular-nums">{gbp(data.periods.mtd.totalAfter)}</span> after monthly cost
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}