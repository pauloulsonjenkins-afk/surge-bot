"use client";

import { useQuery } from "@tanstack/react-query";
import type { LivePick } from "@/server/engine-client";

export type { LivePick };

export class LiveFetchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function useLivePicks(limit = 50) {
  return useQuery({
    queryKey: ["live-picks", limit],
    queryFn: async (): Promise<LivePick[]> => {
      const res = await fetch(`/api/live?limit=${limit}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new LiveFetchError(body?.error ?? `Failed to load live picks (${res.status})`, res.status);
      }
      const data = await res.json();
      return data.picks as LivePick[];
    },
    // Alerts arrive, and get their result edited in, in real time.
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
}
