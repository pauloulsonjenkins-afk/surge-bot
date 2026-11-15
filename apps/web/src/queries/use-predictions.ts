"use client";

import { useQuery } from "@tanstack/react-query";
import { getJson } from "./fetch-json";
import type { Prediction } from "@/server/footballbin";
import { predictionFor } from "@/lib/predictions";

export type { Prediction };
export { predictionFor };

/** Admin only: predictions that are current (usually none; see server/footballbin.ts). Half-hourly, never an error on screen. */
export function usePredictions(enabled: boolean) {
  return useQuery({
    queryKey: ["predictions"],
    enabled,
    queryFn: async ({ signal }) => (await getJson<{ predictions: Prediction[] }>("/api/admin/predictions", "the predictions", signal)).predictions,
    staleTime: 30 * 60_000,
    refetchInterval: 30 * 60_000,
    retry: false,
  });
}
