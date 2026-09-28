"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SendingSettings, SendingState } from "@/server/engine-client";
import { ApiFetchError, getJson } from "./fetch-json";

export type { SendingSettings, SendingState };

const KEY = ["sending"];

export function useSending() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => getJson<SendingState>("/api/admin/sending", "sending options"),
    staleTime: 0,
    refetchInterval: 15_000,
  });
}

export function useRemoveStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (label: string): Promise<{ removed: number; keptBecauseSent: number }> => {
      const res = await fetch("/api/admin/strategies/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiFetchError(body?.error ?? `Could not remove (${res.status})`, res.status);
      }
      return (await res.json()) as { removed: number; keptBecauseSent: number };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["hit-rate-stats"] });
      qc.invalidateQueries({ queryKey: ["live-picks"] });
    },
  });
}

export function useSaveSending() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<SendingSettings>): Promise<SendingState> => {
      const res = await fetch("/api/admin/sending", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiFetchError(body?.error ?? `Could not save (${res.status})`, res.status);
      }
      return (await res.json()) as SendingState;
    },
    onSuccess: (data) => qc.setQueryData(KEY, data),
  });
}
