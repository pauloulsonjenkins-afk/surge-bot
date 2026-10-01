"use client";

import { useQuery } from "@tanstack/react-query";
import type { UnplacedReport } from "@/server/engine-client";
import { getJson } from "./fetch-json";

export type { UnplacedReport };

/** Sent picks with no Betfair bet 3 minutes on (last 24 hours), refreshed every half minute. */
export function useUnplaced() {
  return useQuery({
    queryKey: ["unplaced"],
    queryFn: ({ signal }) => getJson<UnplacedReport>("/api/admin/betfair/unplaced", "picks not placed", signal),
    refetchInterval: 30_000,
  });
}
