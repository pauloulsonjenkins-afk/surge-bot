"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BetfairLinkStatus, BetImportSummary, Placement, ReconcileReport } from "@/server/engine-client";
import { ApiFetchError, getJson } from "./fetch-json";
import { usePersistedQuery } from "./persist";

export type { BetfairLinkStatus, BetImportSummary, Placement, ReconcileReport };

/** Admin only: whether each recently sent pick was placed and matched on Betfair, refreshed as the engine checks. */
export function usePlacements(enabled: boolean) {
  return usePersistedQuery({
    queryKey: ["placements"],
    queryFn: ({ signal }) => getJson<{ link: BetfairLinkStatus; picks: Record<string, Placement> }>("/api/admin/betfair/placements", "bet placements", signal),
    enabled,
    staleTime: 0,
    refetchInterval: 20_000,
  });
}

const KEY = ["reconcile"];

export function useReconcile() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => getJson<ReconcileReport>("/api/admin/betfair", "the reconciliation", signal),
    staleTime: 0,
    refetchInterval: 60_000,
  });
}

/** Adds a suggested "alert name = Betfair name" line to Match names; bets it fixes link at once. */
export function useAddMatchName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { from: string; to: string }): Promise<{ line: string; linked: number }> => {
      const res = await fetch("/api/admin/betfair/match-name", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiFetchError(body?.error ?? `Couldn't add it (${res.status})`, res.status);
      return body as { line: string; linked: number };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ["sending"] });
    },
  });
}

/** Acknowledge unlinked bets (they leave the list), or put acknowledged ones back. */
export function useAcknowledgeBets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { betIds: string[]; acknowledged: boolean }): Promise<{ changed: number }> => {
      const res = await fetch("/api/admin/betfair/acknowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiFetchError(body?.error ?? `Couldn't save (${res.status})`, res.status);
      return body as { changed: number };
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useImportBetHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { csv: string; source: string; timeZone: string | null }): Promise<BetImportSummary> => {
      const res = await fetch("/api/admin/betfair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiFetchError(body?.error ?? `Import failed (${res.status})`, res.status);
      return body as BetImportSummary;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}
