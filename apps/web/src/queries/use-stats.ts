"use client";

import { useQuery } from "@tanstack/react-query";
import type { HitRateRow, HitRateStats, StrategyStats } from "@/server/engine-client";
import { getJson } from "./fetch-json";

export type { HitRateRow, HitRateStats, StrategyStats };

/** days = null means all time. strategy = null means every strategy. */
export function useHitRateStats(days: number | null, strategy: string | null = null) {
  return useQuery({
    queryKey: ["hit-rate-stats", days, strategy],
    queryFn: ({ signal }) => {
      const query = new URLSearchParams();
      if (days) query.set("days", String(days));
      if (strategy) query.set("strategy", strategy);
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
