"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GoalModelReport } from "@/server/engine-client";
import { getJson } from "./fetch-json";

export type { GoalModelReport };

export function useGoalModel(refreshKey: number) {
  return useQuery({
    queryKey: ["goal-model", refreshKey],
    queryFn: ({ signal }) => getJson<GoalModelReport>(`/api/admin/goal-model${refreshKey ? "?refresh=1" : ""}`, "the goal model", signal),
    staleTime: 5 * 60_000,
  });
}

export function usePublishGoalModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/goal-model/publish", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { version?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? `Could not train (${res.status})`);
      return body.version ?? "";
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["goal-model"] }),
  });
}
