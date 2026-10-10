"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiFetchError, getJson } from "./fetch-json";
import { useHydrated } from "./use-me";
import type { EdgeView } from "@/lib/members/edge";
import type { Automation, Community, Dashboard, MembersMe, MemberSettings, Notification, Performance, Plans, StrategyItem, Upcoming, BetView, PickFull } from "@/lib/members/types";

const ROOT = ["members"] as const;

function useMembersGet<T>(path: string, opts: { refetchMs?: number; enabled?: boolean } = {}) {
  const hydrated = useHydrated();
  return useQuery({
    queryKey: [...ROOT, path],
    queryFn: ({ signal }) => getJson<T>(`/api/members/${path}`, "the members area", signal),
    enabled: hydrated && opts.enabled !== false,
    refetchInterval: opts.refetchMs,
    retry: (count, err) => !(err instanceof ApiFetchError && (err.status === 401 || err.status === 403 || err.status === 404)) && count < 2,
  });
}

/** Who the member is (null data with a 401 error when signed out). */
export const useMembersMe = () => useMembersGet<MembersMe>("me", { refetchMs: 60_000 });
export const useMembersDashboard = () => useMembersGet<Dashboard>("dashboard", { refetchMs: 30_000 });
export const useMembersStrategies = () => useMembersGet<{ strategies: StrategyItem[]; trialPicker: { limit: number; days: number } | null }>("strategies", { refetchMs: 60_000 });
export const useMembersStrategy = (key: string) =>
  useMembersGet<{ strategy: StrategyItem & { recent: PickFull[] | null; selectionsLocked: boolean } }>(`strategy?key=${encodeURIComponent(key)}`, { refetchMs: 60_000 });
export const useMembersUpcoming = () => useMembersGet<Upcoming>("upcoming", { refetchMs: 15_000 });
export const useMembersPerformance = (mode: "sim" | "live", range: string) => useMembersGet<Performance>(`performance?mode=${mode}&range=${range}`, { refetchMs: 60_000 });
export const useMembersHistory = (qs: string) => useMembersGet<{ rows: BetView[]; page: number; more: boolean; limitedToDays: number | null }>(`history${qs ? `?${qs}` : ""}`, { refetchMs: 60_000 });
export const useMembersSettings = () => useMembersGet<MemberSettings>("settings");
export const useMembersAutomation = () => useMembersGet<Automation>("automation", { refetchMs: 30_000 });
export const useMembersNotifications = () => useMembersGet<{ notifications: Notification[]; unread: number }>("notifications", { refetchMs: 60_000 });
export const useMembersPlans = () => useMembersGet<Plans>("plans");
export const useMembersCommunity = () => useMembersGet<Community>("community");

/** POST to the members API; on success everything members-related is refreshed. Errors carry the engine's words. */
export function useMembersAction<B = Record<string, unknown>, R = Record<string, unknown>>(path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: B) => {
      const res = await fetch(`/api/members/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
      const data = (await res.json().catch(() => ({}))) as R & { error?: string };
      if (!res.ok) throw new ApiFetchError(data.error ?? "That didn't work. Try again.", res.status);
      return data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ROOT }),
  });
}

/** Records a product event (upgrade prompt shown, premium feature clicked...). Fire and forget. */
export function trackMemberEvent(event: string, props?: Record<string, unknown>): void {
  void fetch("/api/members/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, props }) }).catch(() => {});
}

/** Edge: pre-match insight cards for upcoming fixtures (locked for tiers without "viewEdge"). Refreshed every 10 minutes. */
export const useMembersEdge = () => useMembersGet<EdgeView>("edge", { refetchMs: 10 * 60_000 });
