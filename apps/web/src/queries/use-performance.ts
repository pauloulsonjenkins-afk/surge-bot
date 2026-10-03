"use client";

import { PerformanceCell, ResolvedCell } from "@/domain/performance";
import { resolveCells } from "@/lib/performance/leagues";
import type { PickMode } from "@/server/engine-client";
import { usePersistedQuery } from "./persist";

/**
 * Totals by league, strategy and alert minute for the dashboard's breakdown.
 *
 * Reads GET /api/performance/breakdown?days=N&mode=M and expects { cells: PerformanceCell[] }.
 * If that route is missing or fails, this returns null and the dashboard keeps showing
 * its existing By strategy / By alert minute / By league cards.
 */
export function usePerformanceCells(days: number | null, mode: PickMode = "all") {
  return usePersistedQuery({
    queryKey: ["performance", "cells", days, mode],
    retry: false,
    staleTime: 0,
    refetchInterval: 30_000,
    queryFn: async ({ signal }): Promise<ResolvedCell[] | null> => {
      const query = new URLSearchParams();
      if (days) query.set("days", String(days));
      if (mode !== "all") query.set("mode", mode);
      const qs = query.toString();
      const res = await fetch(`/api/performance/breakdown${qs ? `?${qs}` : ""}`, { cache: "no-store", signal });
      if (!res.ok) return null;
      const body = (await res.json()) as { cells?: PerformanceCell[] };
      return Array.isArray(body.cells) ? resolveCells(body.cells) : null;
    },
  });
}
