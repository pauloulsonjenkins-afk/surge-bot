"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson } from "./fetch-json";
import { usePersistedQuery } from "./persist";
import type { ClaudeVerdictCheck } from "@/server/engine-client";

export type { ClaudeVerdictCheck };

/** Claude's per-alert verdicts compared against settled results, by verdict (server/claude-verdict-check.ts). */
export function useClaudeVerdictCheck() {
  return usePersistedQuery({
    queryKey: ["claude-verdict-check"],
    staleTime: 60_000,
    queryFn: ({ signal }) => getJson<ClaudeVerdictCheck>("/api/admin/claude-verdict-check", "Claude verdict check", signal),
  });
}

/** Shows or hides the Live tab's Claude badge (shadow mode switch) — never touches a bet. */
export function useSetClaudeBadgeVisible() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (badgeVisible: boolean) => {
      const res = await fetch("/api/admin/claude-verdict-check", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ badgeVisible }) });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(out.error ?? "Couldn't change that.");
      return out as ClaudeVerdictCheck;
    },
    onSuccess: (data) => {
      qc.setQueryData(["claude-verdict-check"], data);
      void qc.invalidateQueries({ queryKey: ["admin-live-picks"] });
      void qc.invalidateQueries({ queryKey: ["live-picks"] });
    },
  });
}
