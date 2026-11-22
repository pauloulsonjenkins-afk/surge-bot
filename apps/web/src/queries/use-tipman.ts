"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TipmanState } from "@/server/engine-client";
import { getJson } from "./fetch-json";
import { usePersistedQuery } from "./persist";

export type { TipmanState, TipmanCard, TipmanLeg, TipmanRecord, TipmanCategory } from "@/server/engine-client";

/** TipMan's bets as the tipster sets them up, and the record by category (engine tips/tipman-cards.ts). */
export function useTipman() {
  return usePersistedQuery({
    queryKey: ["tipman"],
    queryFn: ({ signal }) => getJson<TipmanState>("/api/admin/tipman", "TipMan", signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useChangeTipman() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: Record<string, unknown>) => {
      const res = await fetch("/api/admin/tipman", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
      const body = (await res.json().catch(() => ({}))) as TipmanState & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Couldn't change that.");
      return body;
    },
    onSuccess: (data) => qc.setQueryData(["tipman"], data),
  });
}
