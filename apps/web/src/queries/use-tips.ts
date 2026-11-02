"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TipsState } from "@/server/engine-client";
import { getJson } from "./fetch-json";
import { usePersistedQuery } from "./persist";

export type { TipsState, ChannelTip } from "@/server/engine-client";

/** The free tip channels and what was read from them (engine tips/). */
export function useTips() {
  return usePersistedQuery({
    queryKey: ["tips"],
    queryFn: ({ signal }) => getJson<TipsState>("/api/admin/tips", "the free tips", signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useChangeTips() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: Record<string, unknown>) => {
      const res = await fetch("/api/admin/tips", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
      const body = (await res.json().catch(() => ({}))) as TipsState & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Couldn't change the free tips.");
      return body;
    },
    onSuccess: (data) => qc.setQueryData(["tips"], data),
  });
}
