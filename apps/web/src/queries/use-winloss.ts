"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PickMode, WinLossPatch, WinLossState } from "@/server/engine-client";
import { ApiFetchError, getJson } from "./fetch-json";
import { usePersistedQuery } from "./persist";

export type { WinLossPatch, WinLossState };

const KEY = ["winloss"];

const modeQs = (mode: PickMode) => (mode === "all" ? "" : `?mode=${mode}`);

export function useWinLoss(mode: PickMode = "all") {
  return usePersistedQuery({
    queryKey: [...KEY, mode],
    queryFn: () => getJson<WinLossState>(`/api/admin/winloss${modeQs(mode)}`, "the win/loss figures"),
    staleTime: 0,
    refetchInterval: 30_000,
  });
}

export function useSaveWinLoss(mode: PickMode = "all") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: WinLossPatch): Promise<WinLossState> => {
      const res = await fetch(`/api/admin/winloss${modeQs(mode)}`, {
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
    onSuccess: (data) => {
      qc.setQueryData([...KEY, mode], data);
      // A changed stake or price moves every view's figures, not just this one.
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
}
