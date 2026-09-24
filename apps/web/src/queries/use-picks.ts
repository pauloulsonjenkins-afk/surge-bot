"use client";

import { useQuery } from "@tanstack/react-query";

export interface EnginePick {
  id: number;
  receivedAt: string;
  bodySha256: string;
  contentType: string | null;
  signatureVerified: boolean;
  body: string;
}

export function useRecentPicks(limit = 50) {
  return useQuery({
    queryKey: ["picks", limit],
    queryFn: async (): Promise<EnginePick[]> => {
      const res = await fetch(`/api/admin/picks?limit=${limit}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed to load picks (${res.status})`);
      }
      const data = await res.json();
      return data.picks as EnginePick[];
    },
    refetchInterval: 30_000, // picks arrive in real time, so poll rather than wait for a manual refresh
  });
}
