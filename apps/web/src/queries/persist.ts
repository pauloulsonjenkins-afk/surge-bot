"use client";

import { hashKey, useQuery, type QueryClient, type QueryKey, type UseQueryOptions } from "@tanstack/react-query";
import { useHydrated } from "./use-me";

/**
 * Keeps the last figures in the browser between visits, so the app (especially installed on a phone) opens straight
 * onto the numbers it last showed while fresh ones load, instead of on loading placeholders.
 *
 * They are shown as a query's placeholder, and only once that component has hydrated: the server never has them, so
 * showing them during hydration would make the first render differ from the server's HTML. Only what pages open on is
 * kept, never who is signed in, and nothing older than a day. Signing out clears it.
 */
const STORE = "goalbrew-cache-v2";
const OLD_STORES = ["goalbrew-cache-v1"];
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Most queries kept, newest first, so the store stays well inside the browser's storage limit. */
const MAX_ENTRIES = 30;
const KEEP = new Set([
  "hit-rate-stats",
  "performance",
  "winloss",
  "live-picks",
  "admin-live-picks",
  "placements",
  "admin-strategies",
  "schedule",
  "sending",
  "unplaced",
]);

type Snapshot = Record<string, { at: number; data: unknown }>;
let memory: Snapshot | null = null;

function read(): Snapshot {
  if (memory) return memory;
  memory = {};
  try {
    for (const old of OLD_STORES) localStorage.removeItem(old);
    const raw = localStorage.getItem(STORE);
    const saved = raw ? (JSON.parse(raw) as Snapshot) : {};
    const now = Date.now();
    for (const [hash, entry] of Object.entries(saved)) if (now - entry.at < MAX_AGE_MS) memory[hash] = entry;
  } catch {
    // Storage blocked or unreadable: nothing to show, the page loads fresh.
  }
  return memory;
}

/**
 * useQuery, plus the figures kept from the last visit as a placeholder while the first fetch runs. A query's own
 * placeholder (e.g. the previous figures while a filter changes) still comes first.
 */
export function usePersistedQuery<TData>(options: UseQueryOptions<TData, Error, TData, QueryKey>) {
  const hydrated = useHydrated();
  const own = options.placeholderData as ((previous: TData | undefined) => TData | undefined) | TData | undefined;
  return useQuery<TData, Error, TData, QueryKey>({
    ...options,
    placeholderData: (previous: TData | undefined) => {
      const mine = typeof own === "function" ? (own as (p: TData | undefined) => TData | undefined)(previous) : own;
      if (mine !== undefined) return mine;
      return hydrated ? (read()[hashKey(options.queryKey)]?.data as TData | undefined) : undefined;
    },
  } as UseQueryOptions<TData, Error, TData, QueryKey>);
}

/** Saves the kept queries' latest figures a couple of seconds after they change. Returns the way to stop. */
export function keepCache(client: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    timer = null;
    try {
      const snapshot: Snapshot = { ...read() };
      for (const q of client.getQueryCache().getAll()) {
        if (q.state.status === "success" && q.state.data !== undefined && KEEP.has(String(q.queryKey[0]))) {
          snapshot[q.queryHash] = { at: q.state.dataUpdatedAt, data: q.state.data };
        }
      }
      const newest = Object.entries(snapshot)
        .sort((a, b) => b[1].at - a[1].at)
        .slice(0, MAX_ENTRIES);
      memory = Object.fromEntries(newest);
      localStorage.setItem(STORE, JSON.stringify(memory));
    } catch {
      // Storage full or blocked: nothing is kept, and nothing breaks.
    }
  };
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && event.action.type === "success" && timer === null) timer = setTimeout(save, 2000);
  });
  return () => {
    unsubscribe();
    if (timer !== null) clearTimeout(timer);
  };
}

/** Forgets the kept figures (on signing out). */
export function forgetCache(): void {
  memory = {};
  try {
    localStorage.removeItem(STORE);
    for (const old of OLD_STORES) localStorage.removeItem(old);
  } catch {
    // nothing kept
  }
}
