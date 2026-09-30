"use client";

import { useQuery } from "@tanstack/react-query";
import type { WinLossState } from "@/queries/use-winloss";
import type { PickMode } from "@/server/engine-client";
import { getJson } from "@/queries/fetch-json";
import type { Timeframe } from "./TimeframeToggle";

/**
 * Win / loss in pounds, for the Dashboard's hero row. Money figures are private, so this only loads for a
 * signed-in admin: for anyone else the request is refused and the hook returns no data.
 */
export function useDashboardWinLoss(mode: PickMode = "all") {
  return useQuery({
    queryKey: ["winloss", mode],
    queryFn: ({ signal }) =>
      getJson<WinLossState>(`/api/admin/winloss${mode === "all" ? "" : `?mode=${mode}`}`, "the win/loss figures", signal),
    retry: false, // a signed-out visitor is refused once, not three times
    staleTime: 0,
    refetchInterval: 30_000,
  });
}

/**
 * The engine keeps profit for today, the last 7 days, the month so far and the year so far. Each Dashboard
 * timeframe uses the nearest of those, and says which one it is.
 */
const PERIOD_FOR: Record<Timeframe, { key: keyof WinLossState["periods"]; label: string }> = {
  "1D": { key: "d1", label: "Today" },
  "7D": { key: "d7", label: "Last 7 days" },
  "30D": { key: "mtd", label: "Month to date" },
  ALL: { key: "ytd", label: "Year to date" },
};

/** Profit for the chosen timeframe, for every strategy or just the one the Dashboard is filtered to. */
export function profitFor(
  data: WinLossState,
  timeframe: Timeframe,
  strategy: string | null,
): { value: number; label: string; afterCost: number | null } {
  const { key, label } = PERIOD_FOR[timeframe];
  const period = data.periods[key];
  const value = strategy === null ? period.total : (period.strategies[strategy.toLowerCase()] ?? 0);
  // The monthly running cost only applies to the whole account, and only once it has been switched on.
  const afterCost =
    strategy === null && data.settings.expenditure.enabled && period.expenditure > 0 ? period.totalAfter : null;
  return { value, label, afterCost };
}
