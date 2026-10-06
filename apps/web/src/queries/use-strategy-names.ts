"use client";

import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StrategyNameInfo } from "@/server/engine-client";
import { ApiFetchError, getJson } from "./fetch-json";
import { useHydrated } from "./use-me";

export type { StrategyNameInfo };

const KEY = ["strategy-names"];
// The last names seen, kept in the browser so a page shows "Wake-up Call" straight away instead of
// flashing InPlayGuru's name while the list loads.
const STORE = "goalbrew-strategy-names";

type Names = Record<string, Partial<StrategyNameInfo> & { name: string }>;

/** InPlayGuru's name without its bracketed note: what the app shows when a strategy has no name of its own. */
export function strategyLabel(raw: string): string {
  return raw.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim() || raw;
}

/** The key a strategy's name is stored under (the engine's strategyKey). */
export function strategyKey(raw: string): string {
  return strategyLabel(raw).toLowerCase();
}

/** "blistering momentum" -> "Blistering Momentum"; names that already have capitals are left alone. */
function titleIfLower(s: string): string {
  return s === s.toLowerCase() ? s.replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : s;
}

function remembered(): Names | undefined {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Names) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The names the app shows for strategies. `name(raw)` turns InPlayGuru's name ("Time to fight") into the app's
 * ("Wake-up Call"), falling back to InPlayGuru's own; `info(raw)` also has the description, trigger and bet (admin).
 */
export function useStrategyNames() {
  const hydrated = useHydrated();
  const query = useQuery<{ names: Names }>({
    queryKey: KEY,
    queryFn: ({ signal }) => getJson<{ names: Names }>("/api/strategy-names", "strategy names", signal),
    staleTime: 5 * 60 * 1000,
    // Only once hydrated: the server never has them, and the first render must match its HTML.
    placeholderData: () => {
      const names = hydrated ? remembered() : undefined;
      return names ? { names } : undefined;
    },
  });
  const names = query.data?.names;

  useEffect(() => {
    if (!names || query.isPlaceholderData) return;
    try {
      localStorage.setItem(STORE, JSON.stringify(names));
    } catch {
      // Private browsing or storage full: the names still show, they just load fresh next time.
    }
  }, [names, query.isPlaceholderData]);

  return useMemo(
    () => ({
      name: (raw: string) => names?.[strategyKey(raw)]?.name ?? strategyLabel(raw),
      /** "Boiling Point (Blistering Momentum)": the app's name with the original one in brackets, when they differ. */
      full: (raw: string) => {
        const shown = names?.[strategyKey(raw)]?.name ?? strategyLabel(raw);
        const original = titleIfLower(strategyLabel(raw));
        return shown.toLowerCase() === original.toLowerCase() ? shown : `${shown} (${original})`;
      },
      /** The two halves of `full`, for showing the original name smaller (null when it's the same name). */
      parts: (raw: string) => {
        const shown = names?.[strategyKey(raw)]?.name ?? strategyLabel(raw);
        const original = titleIfLower(strategyLabel(raw));
        return { name: shown, original: shown.toLowerCase() === original.toLowerCase() ? null : original };
      },
      info: (raw: string) => names?.[strategyKey(raw)],
      names,
    }),
    [names],
  );
}

/** Saves a strategy's name and description (admin); empty values go back to the default. */
export function useSaveStrategyName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { key: string; name: string; description: string }): Promise<{ names: Names }> => {
      const res = await fetch("/api/admin/strategy-names", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; names?: Names };
      if (!res.ok || !body.names) throw new ApiFetchError(body.error ?? `Failed to save (${res.status})`, res.status);
      return { names: body.names };
    },
    onSuccess: (data) => qc.setQueryData(KEY, data),
  });
}
