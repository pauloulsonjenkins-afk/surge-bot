"use client";

import { useQuery } from "@tanstack/react-query";
import type { LivePick } from "@/server/engine-client";
import { getJson } from "./fetch-json";

export type { LivePick };

export function useLivePicks(limit = 50) {
  return useQuery({
    queryKey: ["live-picks", limit],
    queryFn: async (): Promise<LivePick[]> => {
      const data = await getJson<{ picks: LivePick[] }>(`/api/live?limit=${limit}`, "live picks");
      return data.picks;
    },
    // Alerts arrive, and get their result edited in, in real time.
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
}
