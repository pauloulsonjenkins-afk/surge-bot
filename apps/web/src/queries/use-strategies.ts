"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminStrategies, AdminStrategy, RemoveStrategyResult } from "@/server/engine-client";
import { ApiFetchError, getJson } from "./fetch-json";

export type { AdminStrategies, AdminStrategy, RemoveStrategyResult };

const KEY = ["admin-strategies"];

export function useAdminStrategies() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => getJson<AdminStrategies>("/api/admin/strategies", "the strategies", signal),
    staleTime: 0,
  });
}

function refreshEverything(qc: ReturnType<typeof useQueryClient>) {
  // Merging or deleting changes what the Dashboard, Live page and Sending page show.
  for (const key of [KEY, ["performance"], ["hit-rate-stats"], ["live-picks"], ["admin-live-picks"], ["sending"], ["winloss"]]) {
    void qc.invalidateQueries({ queryKey: key });
  }
}

async function failure(res: Response, fallback: string): Promise<never> {
  const body = await res.json().catch(() => ({}));
  throw new ApiFetchError(body?.error ?? `${fallback} (${res.status})`, res.status);
}

/** Reports `from` under `into`'s name on the Dashboard. into = null undoes it. */
export function useMergeStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { from: string; into: string | null }): Promise<void> => {
      const res = await fetch("/api/admin/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      if (!res.ok) await failure(res, "Could not merge");
    },
    onSuccess: () => refreshEverything(qc),
  });
}

export function useDeleteStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { label: string; ignoreFuture: boolean; includeSent?: boolean }): Promise<RemoveStrategyResult> => {
      const res = await fetch("/api/admin/strategies/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      if (!res.ok) await failure(res, "Could not delete");
      return (await res.json()) as RemoveStrategyResult;
    },
    onSuccess: () => refreshEverything(qc),
  });
}

/** Stops ignoring a strategy's new alerts (or starts). */
export function useIgnoreStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { label: string; ignored: boolean }): Promise<void> => {
      const res = await fetch("/api/admin/strategies/ignore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      if (!res.ok) await failure(res, "Could not save");
    },
    onSuccess: () => refreshEverything(qc),
  });
}