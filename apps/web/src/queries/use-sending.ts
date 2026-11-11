"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { LearnedName, SendingPatch, SendingSettings, SendingState, StopLossPatch, StopLossStatus } from "@/server/engine-client";
import { ApiFetchError, getJson } from "./fetch-json";
import { useDialogOptional } from "@/components/ui/ConfirmDialog";
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

/** The owner chose not to confirm a risky figure: nothing was saved. */
export class SaveCancelled extends ApiFetchError {
  constructor() {
    super("Not saved: you cancelled it.", 422);
  }
}

export function useSaveSending() {
  const qc = useQueryClient();
  const dialog = useDialogOptional();
  return useMutation({
    mutationFn: async (patch: SendingPatch): Promise<SendingState> => {
      const put = (body: SendingPatch) => fetch("/api/admin/sending", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      let res = await put(patch);
      // The engine won't save a big stake or loss limit until its figure is typed again (engine money-guard.ts). Each
      // one is asked for in turn; cancelling any of them saves nothing.
      if (res.status === 422 && dialog) {
        const ask = (await res.json().catch(() => ({}))) as { reason?: string; confirm?: Array<{ what: string; figure: string }> };
        const figures: string[] = [];
        for (const item of ask.confirm ?? []) {
          const ok = await dialog.confirm({
            title: `${item.what}: are you sure?`,
            body: ask.reason,
            typeToConfirm: item.figure,
            confirmLabel: "Save it anyway",
            cancelLabel: "Don't save",
            tone: "danger",
          });
          if (!ok) throw new SaveCancelled();
          figures.push(item.figure);
        }
        if (figures.length === 0) throw new ApiFetchError(ask.reason ?? "Could not save (422)", 422);
        res = await put({ ...patch, confirm: figures });
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiFetchError(body?.reason ?? body?.error ?? `Could not save (${res.status})`, res.status);
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
