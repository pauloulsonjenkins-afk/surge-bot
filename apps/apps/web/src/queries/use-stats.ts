"use client";

import { useQuery } from "@tanstack/react-query";
import type { HitRateRow, HitRateStats, StrategyStats } from "@/server/engine-client";
import { getJson } from "./fetch-json";

export type { HitRateRow, HitRateStats, StrategyStats };

/** days = null means all time. */
export function useHitRateStats(days: number | null) {
  return useQuery({
    queryKey: ["hit-rate-stats", days],
    queryFn: () => getJson<HitRateStats>(`/api/stats${days ? `?days=${days}` : ""}`, "stats"),
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}
