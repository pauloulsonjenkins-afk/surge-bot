"use client";

import type { PerformanceCell, ResolvedCell } from "@/domain/performance";
import { resolveCells } from "@/lib/performance/leagues";
import type { HitRateStats, PickMode } from "@/server/engine-client";
import { getJson } from "./fetch-json";
import { usePersistedQuery } from "./persist";

/**
 * The Dashboard's stats and its per-league breakdown in one request (/api/dashboard), polled every 30 seconds.
 * days = null means all time; `since` takes its place when given; strategy = null means every strategy.
 */
export function useDashboard(days: number | null, strategy: string | null, mode: PickMode, since: string | null) {
  return usePersistedQuery({
    queryKey: ["dashboard", since ?? days, strategy, mode],
    queryFn: async ({ signal }): Promise<{ stats: HitRateStats; cells: ResolvedCell[] | null }> => {
      const q = new URLSearchParams();
      if (since) q.set("since", since);
      else if (days) q.set("days", String(days));
      if (strategy) q.set("strategy", strategy);
      if (mode !== "all") q.set("mode", mode);
      const body = await getJson<{ stats: HitRateStats; cells: PerformanceCell[] | null }>(`/api/dashboard${q.size ? `?${q}` : ""}`, "the dashboard", signal);
      return { stats: body.stats, cells: Array.isArray(body.cells) ? resolveCells(body.cells) : null };
    },
    placeholderData: (previous) => previous,
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}
