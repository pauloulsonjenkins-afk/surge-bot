"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminStrategies, AdminStrategy, PickMode, RemoveStrategyResult, StrategyEquity, StrategyReturn } from "@/server/engine-client";
import { ApiFetchError, getJson } from "./fetch-json";
import { usePersistedQuery } from "./persist";

export type { AdminStrategies, AdminStrategy, RemoveStrategyResult, StrategyEquity, StrategyReturn };

const KEY = ["admin-strategies"];

/** Every strategy; with `since` (an ISO date), its figures count only picks from then on. */
export function useAdminStrategies(since: string | null = null) {
  return usePersistedQuery({
    queryKey: [...KEY, since],
    queryFn: ({ signal }) =>
      getJson<AdminStrategies>(`/api/admin/strategies${since ? `?since=${encodeURIComponent(since)}` : ""}`, "the strategies", signal),
    staleTime: 0,
    // Switching period keeps the cards on screen until the new figures arrive.
    placeholderData: (previous) => previous,
  });
}

/** One strategy's equity curve, loaded only when its chart is opened. */
export function useStrategyEquity(label: string, mode: PickMode, enabled: boolean) {
  return useQuery({
    queryKey: ["strategy-equity", label, mode],
    queryFn: ({ signal }) => {
      const q = new URLSearchParams({ label });
      if (mode !== "all") q.set("mode", mode);
      return getJson<StrategyEquity>(`/api/admin/strategies/equity?${q}`, "the equity curve", signal);
    },
    enabled,
    staleTime: 60_000,
  });
}

function refreshEverything(qc: ReturnType<typeof useQueryClient>) {
  // Merging or deleting changes what the Dashboard, Live page and Sending page show.
  for (const key of [KEY, ["performance"], ["hit-rate-stats"], ["live-picks"], ["admin-live-picks"], ["sending"], ["winloss"]]) {
    void qc.invalidateQueries({ queryKey: key });
  }
}

async function failure(res: Response, fallback: string): Promise<never> {
  const body = await res.json().catch(() => ({}));
  throw new ApiFetchError(body?.error ?? `${fallback} (${res.status})`, res.status);
}

/** Reports `from` under `into`'s name on the Dashboard. into = null undoes it. */
export function useMergeStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { from: string; into: string | null }): Promise<void> => {
      const res = await fetch("/api/admin/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      if (!res.ok) await failure(res, "Could not merge");
    },
    onSuccess: () => refreshEverything(qc),
  });
}

export function useDeleteStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { label: string; ignoreFuture: boolean; includeSent?: boolean }): Promise<RemoveStrategyResult> => {
      const res = await fetch("/api/admin/strategies/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      if (!res.ok) await failure(res, "Could not delete");
      return (await res.json()) as RemoveStrategyResult;
    },
    onSuccess: () => refreshEverything(qc),
  });
}

/** Stops ignoring a strategy's new alerts (or starts). */
export function useIgnoreStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { label: string; ignored: boolean }): Promise<void> => {
      const res = await fetch("/api/admin/strategies/ignore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      if (!res.ok) await failure(res, "Could not save");
    },
    onSuccess: () => refreshEverything(qc),
  });
}
export type Light = "good" | "bad" | "ok" | "few";

/** Below this many priced picks a return is too noisy to colour. */
const LIGHT_SAMPLE = 20;

/**
 * A traffic light per strategy for the dashboard's breakdown, from its all-time return per £1: green when it makes
 * money, red when it loses it, amber when it is about level, grey when there are too few picks. Admin only (the
 * figures come from the admin strategies route), so nothing loads for anyone else.
 */
export function useStrategyLights(enabled: boolean, mode: PickMode) {
  return useQuery({
    queryKey: [...KEY, "lights"],
    enabled,
    staleTime: 60_000,
    queryFn: ({ signal }) => getJson<AdminStrategies>("/api/admin/strategies", "the strategies", signal),
    select: (d): Map<string, { light: Light; roi: number | null; counted: number }> => {
      const out = new Map<string, { light: Light; roi: number | null; counted: number }>();
      for (const s of d.strategies) {
        const r = s.returns;
        if (!r) continue;
        const pick = mode === "all" ? (r.all ?? null) : r[mode];
        const staked = pick ? pick.staked : r.live.staked + r.sim.staked;
        const profit = pick ? pick.profit : r.live.profit + r.sim.profit;
        const counted = pick ? pick.counted : r.live.counted + r.sim.counted;
        const roi = staked > 0 ? profit / staked : null;
        const light: Light = roi === null || counted < LIGHT_SAMPLE ? "few" : roi > 0.03 ? "good" : roi < -0.03 ? "bad" : "ok";
        out.set(s.label.toLowerCase(), { light, roi, counted });
      }
      return out;
    },
  });
}
