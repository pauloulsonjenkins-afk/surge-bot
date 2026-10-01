"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BetImportSummary, ReconcileReport } from "@/server/engine-client";
import { ApiFetchError, getJson } from "./fetch-json";

export type { BetImportSummary, ReconcileReport };

const KEY = ["reconcile"];

export function useReconcile() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => getJson<ReconcileReport>("/api/admin/betfair", "the reconciliation", signal),
    staleTime: 0,
    refetchInterval: 60_000,
  });
}

export function useImportBetHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { csv: string; source: string }): Promise<BetImportSummary> => {
      const res = await fetch("/api/admin/betfair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiFetchError(body?.error ?? `Import failed (${res.status})`, res.status);
      return body as BetImportSummary;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}
