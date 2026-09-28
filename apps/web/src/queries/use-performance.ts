"use client";

import { useQuery } from "@tanstack/react-query";
import { PerformanceAlert, ResolvedAlert } from "@/domain/performance";
import { resolveAlerts } from "@/lib/performance/leagues";

/**
 * Alert history for the dashboard's league / strategy / minute breakdown.
 *
 * Reads GET /api/performance/alerts?days=N and expects { alerts: PerformanceAlert[] }
 * (league, country, strategy, minute, outcome for each alert in the window).
 *
 * If that endpoint doesn't exist yet or fails, this returns null and the dashboard keeps
 * showing its existing By strategy / By league cards. No placeholder numbers are ever shown.
 */
export function usePerformanceAlerts(days: number | null) {
  return useQuery({
    queryKey: ["performance", "alerts", days],
    retry: false,
    refetchInterval: (query) => (query.state.data ? 60_000 : false),
    queryFn: async (): Promise<ResolvedAlert[] | null> => {
      const res = await fetch(`/api/performance/alerts${days ? `?days=${days}` : ""}`, { cache: "no-store" });
      if (!res.ok) return null;
      const body = (await res.json()) as { alerts?: PerformanceAlert[] };
      return Array.isArray(body.alerts) ? resolveAlerts(body.alerts) : null;
    },
  });
}
