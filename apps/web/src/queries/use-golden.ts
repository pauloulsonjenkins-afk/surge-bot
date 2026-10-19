"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson } from "./fetch-json";
import type { GoldenReport, GoldenSlice, GoldenSuggestion } from "@/server/engine-client";

export type { GoldenReport, GoldenSlice, GoldenSuggestion };

export function useGolden() {
  return useQuery({
    queryKey: ["golden"],
    staleTime: 60_000,
    queryFn: ({ signal }) => getJson<GoldenReport>("/api/admin/golden", "Golden", signal),
  });
}

export function useGoldenAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { action: "watch"; strategyKey: string; rule: string[] } | { action: "unwatch"; strategyKey: string; id: string }) => {
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
