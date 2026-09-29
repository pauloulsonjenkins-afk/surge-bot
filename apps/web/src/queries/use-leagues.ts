"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminLeagueRow, LeaguePatch } from "@/server/engine-client";
import { ApiFetchError, getJson } from "./fetch-json";

export type { AdminLeagueRow, LeaguePatch };

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
