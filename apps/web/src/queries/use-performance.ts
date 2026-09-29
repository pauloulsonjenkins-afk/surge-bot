"use client";

import { useQuery } from "@tanstack/react-query";
import { PerformanceCell, ResolvedCell } from "@/domain/performance";
import { resolveCells } from "@/lib/performance/leagues";

/**
 * Totals by league, strategy and alert minute for the dashboard's breakdown.
 *
 * Reads GET /api/performance/breakdown?days=N and expects { cells: PerformanceCell[] }.
 * If that route is missing or fails, this returns null and the dashboard keeps showing
 * its existing By strategy / By alert minute / By league cards.
 */
export function usePerformanceCells(days: number | null) {
  return useQuery({
    queryKey: ["performance", "cells", days],
    retry: false,
    staleTime: 0,
    refetchInterval: 30_000,
    queryFn: async (): Promise<ResolvedCell[] | null> => {
      const res = await fetch(`/api/performance/breakdown${days ? `?days=${days}` : ""}`, { cache: "no-store" });
      if (!res.ok) return null;
      const body = (await res.json()) as { cells?: PerformanceCell[] };
      return Array.isArray(body.cells) ? resolveCells(body.cells) : null;
    },
  });
}
