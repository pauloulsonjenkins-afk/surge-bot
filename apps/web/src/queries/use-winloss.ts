"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WinLossPatch, WinLossState } from "@/server/engine-client";
import { ApiFetchError, getJson } from "./fetch-json";

export type { WinLossPatch, WinLossState };

const KEY = ["winloss"];

export function useWinLoss() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => getJson<WinLossState>("/api/admin/winloss", "the win/loss figures"),
    staleTime: 0,
    refetchInterval: 30_000,
  });
}

export function useSaveWinLoss() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: WinLossPatch): Promise<WinLossState> => {
      const res = await fetch("/api/admin/winloss", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiFetchError(body?.error ?? `Could not save (${res.status})`, res.status);
      }
      return (await res.json()) as WinLossState;
    },
    onSuccess: (data) => qc.setQueryData(KEY, data),
  });
}
