"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LayReport } from "@/server/engine-client";
import { getJson } from "./fetch-json";

export type {  LayIdea, LayReport } from "@/server/engine-client";

/** The LAY section: each LAY group and the lay ideas. */
export function useLayGroups(enabled = true) {
  return useQuery({
    queryKey: ["lay-groups"],
    queryFn: ({ signal }) => getJson<LayReport>("/api/admin/lay-groups", "the LAY groups", signal),
    enabled,
    staleTime: 60_000,
  });
}

/** Lay an idea in Sim, or stop laying a group added from one. */
export function useLayGroupAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/admin/lay-groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as LayReport & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Couldn't do that.");
      return data;
    },
    onSuccess: (data) => {
      qc.setQueryData(["lay-groups"], data);
      void qc.invalidateQueries({ queryKey: ["admin-strategies"] });
      void qc.invalidateQueries({ queryKey: ["sending"] });
    },
  });
}
