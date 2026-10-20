"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson } from "./fetch-json";
import { usePersistedQuery } from "./persist";
import type { GoldenActionBody, GoldenReport, GoldenSlice, GoldenSuggestion } from "@/server/engine-client";

export type { GoldenReport, GoldenSlice, GoldenSuggestion };

/**
 * The Golden report, opening on the figures from the last visit while fresh ones load. Pass enabled=false where the
 * visitor may not be the admin (the Live tab).
 */
export function useGolden(enabled = true) {
  return usePersistedQuery({
    queryKey: ["golden"],
    staleTime: 60_000,
    enabled,
    queryFn: ({ signal }) => getJson<GoldenReport>("/api/admin/golden", "Golden", signal),
  });
}

/** Looks up a watched slice's status ("strategy key", slice id), or null until the report has loaded. */
export function useSliceStatus(enabled = true) {
  const { data } = useGolden(enabled);
  return (strategyKey: string, id: string): GoldenSlice["status"] | null =>
    data?.slices.find((s) => s.strategyKey === strategyKey.toLowerCase() && s.id === id)?.status ?? null;
}

export function useGoldenAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: GoldenActionBody) => {
      const res = await fetch("/api/admin/golden", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(out.error ?? "Couldn't change that.");
      return out as GoldenReport;
    },
    onSuccess: (data) => {
      qc.setQueryData(["golden"], data);
      void qc.invalidateQueries({ queryKey: ["admin-strategies"] });
    },
  });
}
