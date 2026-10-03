"use client";

import type { HitRateRow, HitRateStats, PickMode, StrategyStats } from "@/server/engine-client";
import { getJson } from "./fetch-json";
import { usePersistedQuery } from "./persist";

export type { HitRateRow, HitRateStats, StrategyStats };

/**
 * days = null means all time; `since` (an ISO time, e.g. UK midnight for "Today") takes its place when given.
 * strategy = null means every strategy. mode = live / sim picks only (admin), or all.
 */
export function useHitRateStats(days: number | null, strategy: string | null = null, mode: PickMode = "all", since: string | null = null) {
  return usePersistedQuery({
    queryKey: ["hit-rate-stats", since ?? days, strategy, mode],
    queryFn: ({ signal }) => {
      const query = new URLSearchParams();
      if (since) query.set("since", since);
      else if (days) query.set("days", String(days));
      if (strategy) query.set("strategy", strategy);
      if (mode !== "all") query.set("mode", mode);
      const qs = query.toString();
      return getJson<HitRateStats>(`/api/stats${qs ? `?${qs}` : ""}`, "stats", signal);
    },
    // Keep showing the previous figures while a different strategy loads, so the page doesn't flash.
    placeholderData: (previous) => previous,
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}
