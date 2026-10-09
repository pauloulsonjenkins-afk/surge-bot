"use client";

import { useQuery } from "@tanstack/react-query";
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
