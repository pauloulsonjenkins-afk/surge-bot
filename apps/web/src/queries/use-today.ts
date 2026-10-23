"use client";

import { useQuery } from "@tanstack/react-query";
import type { NotPlacedReport, SpeedReport, StrategyAdvice, TodaySnapshot } from "@/server/engine-client";
import { getJson } from "./fetch-json";

export type { NotPlacedReport, SpeedReport, TodaySnapshot };

/** The Today page: refreshed every 15 seconds while it's open and visible. */
export function useToday() {
  return useQuery({
    queryKey: ["today"],
    queryFn: ({ signal }) => getJson<TodaySnapshot>("/api/admin/today", "today's summary", signal),
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
}

/** The strategy suggestions on their own, for the menus' count badge: checked every two minutes, a light call. */
export function useAdviceCount(): number {
  const q = useQuery({
    queryKey: ["advice-count"],
    queryFn: ({ signal }) => getJson<{ advice: StrategyAdvice[] }>("/api/admin/advice", "suggestions", signal),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });
  return q.data?.advice.length ?? 0;
}

export function useNotPlaced(days: number) {
  return useQuery({
    queryKey: ["not-placed", days],
    queryFn: ({ signal }) => getJson<NotPlacedReport>(`/api/admin/not-placed?days=${days}`, "the not-placed report", signal),
    staleTime: 60_000,
  });
}
