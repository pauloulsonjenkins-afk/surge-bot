"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HorseBet, HorseDay, HorseEntryInput } from "@/server/engine-client";
import { ApiFetchError, getJson } from "./fetch-json";

export type { HorseBet, HorseDay, HorseEntryInput };

const KEY = ["horses"];

export function useHorseBets() {
  return useQuery({
    queryKey: KEY,
    queryFn: async ({ signal }) => {
      const data = await getJson<{ bets: HorseBet[]; days?: HorseDay[] }>("/api/admin/horses", "your horse bets", signal);
      return { bets: data.bets, days: data.days ?? [] };
    },
    staleTime: 30_000,
  });
}

async function send(url: string, method: "PUT" | "POST", body: unknown, fallback: string): Promise<unknown> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiFetchError(data?.error ?? `${fallback} (${res.status})`, res.status);
  return data;
}

export function useSaveHorseDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { day: string; entries: HorseEntryInput[]; yankeeStake: string | null }) => send("/api/admin/horses", "PUT", v, "Could not save"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSetHorseResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; result: HorseBet["result"] }) => send("/api/admin/horses/result", "POST", v, "Could not save the result"),
    // Show the new result straight away; the refetch confirms it.
    onMutate: (v) =>
      qc.setQueryData<{ bets: HorseBet[]; days: HorseDay[] }>(KEY, (old) =>
        old ? { ...old, bets: old.bets.map((b) => (b.id === v.id ? { ...b, result: v.result } : b)) } : old,
      ),
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}
