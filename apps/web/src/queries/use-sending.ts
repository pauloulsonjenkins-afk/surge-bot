"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { LearnedName, SendingPatch, SendingSettings, SendingState, StopLossPatch, StopLossStatus } from "@/server/engine-client";
import { ApiFetchError, getJson } from "./fetch-json";
import { usePersistedQuery } from "./persist";

export type { LearnedName, SendingPatch, SendingSettings, SendingState, StopLossPatch, StopLossStatus };

const KEY = ["sending"];

/** Sending settings and the feed preview. The Sending page refreshes every 15 seconds; the Dashboard's strip, which only needs the switch, asks less often. */
export function useSending(refetchInterval = 15_000) {
  return usePersistedQuery({
    queryKey: KEY,
    queryFn: () => getJson<SendingState>("/api/admin/sending", "sending options"),
    staleTime: 0,
    refetchInterval,
  });
}

export function useRemoveStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (label: string): Promise<{ removed: number; keptBecauseSent: number }> => {
      const res = await fetch("/api/admin/strategies/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiFetchError(body?.error ?? `Could not remove (${res.status})`, res.status);
      }
      return (await res.json()) as { removed: number; keptBecauseSent: number };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["hit-rate-stats"] });
      qc.invalidateQueries({ queryKey: ["live-picks"] });
    },
  });
}

export function useSaveSending() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: SendingPatch): Promise<SendingState> => {
      const res = await fetch("/api/admin/sending", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiFetchError(body?.error ?? `Could not save (${res.status})`, res.status);
      }
      return (await res.json()) as SendingState;
    },
    onSuccess: (data) => {
      qc.setQueryData(KEY, data);
      // The Strategies page groups strategies by Live / Sim and shows their stakes.
      void qc.invalidateQueries({ queryKey: ["admin-strategies"] });
      // Golden shows how each slice is bet.
      void qc.invalidateQueries({ queryKey: ["golden"] });
    },
  });
}

/** Takes a team name learned by itself back out of Match names. */
export function useUndoLearnedName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (n: { from: string; to: string }): Promise<string> => {
      const res = await fetch("/api/admin/betfair/match-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...n, undo: true }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) throw new ApiFetchError(body.error ?? `Couldn't undo it (${res.status})`, res.status);
      return body.message ?? "Undone.";
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}
