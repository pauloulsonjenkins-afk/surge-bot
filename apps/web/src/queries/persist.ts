"use client";

import { dehydrate, hydrate, type QueryClient } from "@tanstack/react-query";

/**
 * Keeps the last figures in the browser between visits, so the app (especially installed on a phone) opens straight
 * onto the numbers it last showed while fresh ones load, instead of on loading placeholders. Only what pages open on is
 * kept, never who is signed in (always asked fresh), and nothing older than a day. Signing out clears it.
 */
const STORE = "goalbrew-cache-v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
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
  "strategy-names",
]);

/** Puts the kept figures back. Called after the page has hydrated, so the first render still matches the server's. */
export function restoreCache(client: QueryClient): void {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return;
    const saved = JSON.parse(raw) as { at: number; state: Parameters<typeof hydrate>[1] };
    if (Date.now() - saved.at > MAX_AGE_MS) {
      localStorage.removeItem(STORE);
      return;
    }
    hydrate(client, saved.state);
  } catch {
    // Storage blocked or unreadable: the page simply loads fresh.
  }
}

/** Saves the kept figures a couple of seconds after they change. Returns the way to stop. */
export function keepCache(client: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    timer = null;
    try {
      const state = dehydrate(client, {
        shouldDehydrateQuery: (q) => q.state.status === "success" && KEEP.has(String(q.queryKey[0])),
      });
      localStorage.setItem(STORE, JSON.stringify({ at: Date.now(), state }));
    } catch {
      // Storage full or blocked: nothing is kept, and nothing breaks.
    }
  };
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && timer === null) timer = setTimeout(save, 2000);
  });
  return () => {
    unsubscribe();
    if (timer !== null) clearTimeout(timer);
  };
}

/** Forgets the kept figures (on signing out). */
export function forgetCache(): void {
  try {
    localStorage.removeItem(STORE);
  } catch {
    // nothing kept
  }
}
