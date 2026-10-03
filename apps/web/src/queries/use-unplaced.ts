"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { UnplacedReport } from "@/server/engine-client";
import { ApiFetchError, getJson } from "./fetch-json";
import { usePersistedQuery } from "./persist";

export type { UnplacedReport };

const KEY = ["unplaced"];

/** Sent picks with no Betfair bet 3 minutes on (last 24 hours), refreshed every half minute. */
export function useUnplaced() {
  return usePersistedQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => getJson<UnplacedReport>("/api/admin/betfair/unplaced", "picks not placed", signal),
    refetchInterval: 30_000,
  });
}

/** Clears reviewed picks from the Not placed list. They go from the list at once, before the engine answers. */
export function useClearUnplaced() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: number[]): Promise<{ cleared: number }> => {
      const res = await fetch("/api/admin/betfair/unplaced", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; cleared?: number };
      if (!res.ok) throw new ApiFetchError(body.error ?? `Failed to clear (${res.status})`, res.status);
      return { cleared: body.cleared ?? 0 };
    },
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: KEY });
      const before = qc.getQueryData<UnplacedReport>(KEY);
      if (before) qc.setQueryData<UnplacedReport>(KEY, { ...before, picks: before.picks.filter((p) => !ids.includes(p.id)) });
      return { before };
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.before) qc.setQueryData(KEY, ctx.before);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Adds Betfair's team spelling to Match names and sends the pick again; the message says what happened. */
export function useFixUnplaced() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number): Promise<{ sent: boolean; message: string }> => {
      const res = await fetch("/api/admin/betfair/unplaced/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; sent?: boolean; message?: string };
      if (!res.ok) throw new ApiFetchError(body.error ?? `Failed to fix (${res.status})`, res.status);
      return { sent: Boolean(body.sent), message: body.message ?? "Done." };
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ["sending"] });
    },
  });
}
