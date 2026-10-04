"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiFetchError, getJson } from "./fetch-json";
import type { DirectSettings, DirectStatus } from "@/server/engine-client";

const KEY = ["direct"];

/** Direct betting's settings, readiness and recent bets. Refreshed every 10 s while the page is open. */
export function useDirect() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => getJson<DirectStatus>("/api/admin/direct", "direct betting", signal),
    refetchInterval: 10_000,
  });
}

export function useSaveDirect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<DirectSettings>): Promise<DirectStatus> => {
      const res = await fetch("/api/admin/direct", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiFetchError(body?.error ?? `Could not save (${res.status})`, res.status);
      return body as DirectStatus;
    },
    onSuccess: (data) => qc.setQueryData(KEY, data),
  });
}
