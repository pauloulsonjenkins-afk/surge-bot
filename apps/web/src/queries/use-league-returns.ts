"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson } from "./fetch-json";
import type { LeagueReturnsReport, LeagueTally } from "@/server/engine-client";

export type { LeagueReturnsReport, LeagueTally };

/** Leagues → Profit figures since `since` (null = all time). */
export function useLeagueReturns(since: string | null) {
  return useQuery({
    queryKey: ["league-returns", since],
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => getJson<LeagueReturnsReport>(`/api/admin/leagues/returns${since ? `?since=${encodeURIComponent(since)}` : ""}`, "league profit", signal),
  });
}

/** Stops or restarts a strategy in one league. */
export function useSetLeagueBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { strategy: string; leagueKey: string; league: string; blocked: boolean }) => {
      const res = await fetch("/api/admin/leagues/block", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(out.error ?? "Couldn't change that.");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["league-returns"] });
      void qc.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

/** Return per £1, its likely range (about 95%) and the verdict, as the engine judges it (league-returns.ts judge). */
export function judgeTally(t: LeagueTally, from = 50): { roi: number | null; adjusted: number | null; low: number | null; high: number | null; verdict: "early" | "losing" | "winning" | "unclear" } {
  if (t.counted === 0 || t.staked <= 0) return { roi: null, adjusted: null, low: null, high: null, verdict: "early" };
  const roi = t.profit / t.staked;
  const adjusted = (roi * t.counted) / (t.counted + 50);
  if (t.counted < 2) return { roi, adjusted, low: null, high: null, verdict: "early" };
  const mean = t.sumR / t.counted;
  const variance = Math.max(0, (t.sumR2 - t.counted * mean * mean) / (t.counted - 1));
  const half = 1.96 * Math.sqrt(variance / t.counted);
  const low = roi - half;
  const high = roi + half;
  return { roi, adjusted, low, high, verdict: t.counted < from ? "early" : high < 0 ? "losing" : low > 0 ? "winning" : "unclear" };
}

export function addTally(a: LeagueTally, b: LeagueTally): LeagueTally {
  return {
    picks: a.picks + b.picks,
    won: a.won + b.won,
    lost: a.lost + b.lost,
    counted: a.counted + b.counted,
    staked: a.staked + b.staked,
    profit: a.profit + b.profit,
    sumR: a.sumR + b.sumR,
    sumR2: a.sumR2 + b.sumR2,
  };
}

export const EMPTY_TALLY: LeagueTally = { picks: 0, won: 0, lost: 0, counted: 0, staked: 0, profit: 0, sumR: 0, sumR2: 0 };
