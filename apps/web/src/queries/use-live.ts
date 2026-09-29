"use client";

import { useQuery } from "@tanstack/react-query";
import type { LivePick, PublicPick } from "@/server/engine-client";
import { getJson } from "./fetch-json";

export type { LivePick, PublicPick };

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiFetchError } from "./fetch-json";

/** Amend one pick's result by hand (null puts back the alert's own result). */
export function useSetPickExcluded() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: number; excluded: boolean }) => {
      const res = await fetch("/api/admin/picks/exclude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiFetchError(body?.error ?? `Could not save (${res.status})`, res.status);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-live-picks"] });
      qc.invalidateQueries({ queryKey: ["live-picks"] });
      qc.invalidateQueries({ queryKey: ["hit-rate-stats"] });
      qc.invalidateQueries({ queryKey: ["winloss"] });
    },
  });
}

export function useSetPickResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: number; result: "hit" | "miss" | null }) => {
      const res = await fetch("/api/admin/picks/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiFetchError(body?.error ?? `Could not save (${res.status})`, res.status);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["live-picks"] });
      qc.invalidateQueries({ queryKey: ["admin-live-picks"] });
      qc.invalidateQueries({ queryKey: ["hit-rate-stats"] });
    },
  });
}

export function useLivePicks(limit = 50) {
  return useQuery({
    queryKey: ["live-picks", limit],
    queryFn: async ({ signal }): Promise<PublicPick[]> => {
      const data = await getJson<{ picks: PublicPick[] }>(`/api/live?limit=${limit}`, "live picks", signal);
      return data.picks;
    },
    // Alerts arrive, and get their result edited in, in real time.
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
}

/** Signed-in view for the Results page (includes what is needed to amend a result). */
export function useAdminLivePicks(limit = 100) {
  return useQuery({
    queryKey: ["admin-live-picks", limit],
    queryFn: async (): Promise<LivePick[]> => {
      const data = await getJson<{ picks: LivePick[] }>(`/api/admin/live?limit=${limit}`, "picks");
      return data.picks;
    },
    staleTime: 0,
    refetchInterval: 15_000,
  });
}

/** Which picks the Results page shows: the last 24 hours, or one UK day (YYYY-MM-DD). */
export type ResultsWindow = { kind: "recent" } | { kind: "date"; date: string };

export function useAdminPicksWindow(window: ResultsWindow) {
  const qs = window.kind === "recent" ? "hours=24" : `date=${window.date}`;
  return useQuery({
    queryKey: ["admin-live-picks", "window", qs],
    queryFn: async ({ signal }): Promise<LivePick[]> => {
      const data = await getJson<{ picks: LivePick[] }>(`/api/admin/live?${qs}`, "picks", signal);
      return data.picks;
    },
    staleTime: 0,
    // Past days don't change unless a result is amended by hand, so they refresh far less often.
    refetchInterval: window.kind === "recent" ? 15_000 : 60_000,
  });
}

export interface PickDay {
  date: string;
  picks: number;
  hits: number;
  misses: number;
}

export function usePickDays() {
  return useQuery({
    queryKey: ["admin-pick-days"],
    queryFn: async ({ signal }): Promise<PickDay[]> => (await getJson<{ days: PickDay[] }>("/api/admin/live/days", "the days", signal)).days,
    staleTime: 60_000,
  });
}
