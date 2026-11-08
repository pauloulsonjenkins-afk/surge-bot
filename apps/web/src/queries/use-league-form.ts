"use client";

import { useQuery } from "@tanstack/react-query";
import { getJson } from "./fetch-json";
import type { FilterBacktest, LeagueFilter, LeagueFormReport, LeagueFormRow } from "@/server/engine-client";

export type { FilterBacktest, LeagueFilter, LeagueFormReport, LeagueFormRow };

/** Every strategy's verdict in every league (worked out hourly by the engine), and the league-filter backtest. */
export function useLeagueForm() {
  return useQuery({
    queryKey: ["league-form"],
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) => getJson<LeagueFormReport>("/api/admin/leagues/form", "league form", signal),
  });
}
