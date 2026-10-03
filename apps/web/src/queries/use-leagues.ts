"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminLeagueRow, CoverageReport, CoverageResult, LeaguePatch } from "@/server/engine-client";
import { ApiFetchError, getJson } from "./fetch-json";

export type { AdminLeagueRow, CoverageReport, CoverageResult, LeaguePatch };

/** Which of the leagues your alerts came from are on Betfair. */
export function useCoverage() {
  return useQuery({
    queryKey: ["betfair-coverage"],
    queryFn: ({ signal }) => getJson<CoverageReport>("/api/admin/betfair/coverage", "the Betfair coverage", signal),
    staleTime: 60_000,
  });
}

/** Checks a pasted list of league names (e.g. InPlayGuru's) against Betfair. */
export function useCheckCoverage() {
  return useMutation({
    mutationFn: async ({ names, save }: { names: string[]; save: boolean }): Promise<CoverageReport> => {
      const res = await fetch("/api/admin/betfair/coverage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ names, save }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiFetchError(body?.error ?? `Couldn't check the list (${res.status})`, res.status);
      return body as CoverageReport;
    },
  });
}

/** Matches a league to a Betfair competition by hand ("none": not on Betfair; null: back to matching by name). */
export function useSetLeagueOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { league: string; competition: string | null }) => {
      const res = await fetch("/api/admin/betfair/coverage/override", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiFetchError(body?.error ?? `Couldn't save (${res.status})`, res.status);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["betfair-coverage"] }),
  });
}

const KEY = ["admin-leagues"];

export function useAdminLeagues() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => (await getJson<{ leagues: AdminLeagueRow[] }>("/api/admin/leagues", "the leagues")).leagues,
    staleTime: 0,
  });
}

export function useUpdateLeague() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, patch }: { key: string; patch: LeaguePatch }): Promise<void> => {
      const res = await fetch("/api/admin/leagues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, ...patch }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiFetchError(body?.error ?? `Could not save (${res.status})`, res.status);
      }
    },
    onSuccess: () => {
      // The Dashboard's figures depend on these choices, so refresh them too.
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ["performance"] });
      void qc.invalidateQueries({ queryKey: ["hit-rate-stats"] });
    },
  });
}
