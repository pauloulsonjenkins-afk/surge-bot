"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Told when this page changes the address itself (replaceState fires no event of its own). */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("popstate", onChange);
  };
}

/**
 * A page choice (period, sort, view...) kept in the address, so a refresh, the back button or a shared link opens the
 * page as it was. The default is left out of the address; anything not on the list is ignored. On the server (no
 * address bar) it is the default, so both renders agree.
 */
export function useUrlChoice<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (next: T) => void] {
  const read = (): T => {
    const got = new URLSearchParams(window.location.search).get(key);
    return got !== null && (allowed as readonly string[]).includes(got) ? (got as T) : fallback;
  };
  const value = useSyncExternalStore(subscribe, read, () => fallback);
  const choose = useCallback(
    (next: T) => {
      const url = new URL(window.location.href);
      if (next === fallback) url.searchParams.delete(key);
      else url.searchParams.set(key, next);
      window.history.replaceState(window.history.state, "", url);
      for (const l of listeners) l();
    },
    [key, fallback],
  );
  return [value, choose];
}
