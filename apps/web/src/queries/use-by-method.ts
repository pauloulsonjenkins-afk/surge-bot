"use client";

import type { ByMethodReport } from "@/server/engine-client";
import { getJson } from "./fetch-json";
import { usePersistedQuery } from "./persist";

export type { ByMethodReport };

/** Bets placed by hand against bets GoalBrew placed itself (admin only). */
export function useByMethod() {
  return usePersistedQuery({
    queryKey: ["by-method"],
    queryFn: ({ signal }) => getJson<ByMethodReport>("/api/admin/by-method", "the by-hand comparison", signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
