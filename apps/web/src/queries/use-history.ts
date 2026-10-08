"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HistoryStatus, LayTestResult, LeagueProfile } from "@/server/engine-client";
import { getJson } from "./fetch-json";

export type { HistoryStatus, LayTestResult, LeagueProfile };

const KEY = ["history"];

/** League profiles; checks again every few seconds while the files are still downloading. */
export function useLeagueHistory(seasons: number) {
  return useQuery({
    queryKey: [...KEY, "profiles", seasons],
    queryFn: ({ signal }) =>
      getJson<{ status: HistoryStatus; seasons: number; maxSeasons: number; profiles: LeagueProfile[] }>(`/api/admin/history?seasons=${seasons}`, "the league history", signal),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.status.state === "ready" || q.state.data?.status.state === "failed" ? false : 4000),
  });
}

export interface LayTestQuery {
  min: number;
  max: number;
  commission: number;
  spread: number;
  seasons: number;
  divs: string[];
}

export function useAwayLayTest(q: LayTestQuery, enabled: boolean) {
  const params = new URLSearchParams({
    min: String(q.min),
    max: String(q.max),
    commission: String(q.commission),
    spread: String(q.spread),
    seasons: String(q.seasons),
    divs: q.divs.join(","),
  });
  return useQuery({
    queryKey: [...KEY, "away-lay", params.toString()],
    queryFn: ({ signal }) => getJson<LayTestResult>(`/api/admin/history/away-lay?${params}`, "the Away Win Lay test", signal),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useRefreshHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/history/refresh", { method: "POST" });
      if (!res.ok) throw new Error(`Could not refresh (${res.status})`);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}
