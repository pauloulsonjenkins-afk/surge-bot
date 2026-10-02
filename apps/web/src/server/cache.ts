/**
 * A tiny in-memory cache for the public data routes, so many people (or one
 * person with several tabs open) don't each make the engine do the work again
 * within a few seconds.
 *
 *  - Requests that arrive together while a value is loading share that one
 *    load, instead of each asking the engine (no stampede when an entry expires).
 *  - If a reload fails, the last good value is served for up to STALE_MS, so a
 *    brief engine restart doesn't blank the dashboard for every viewer.
 */
const STALE_MS = 2 * 60 * 1000;
const MAX_ENTRIES = 50;

interface Entry {
  at: number;
  value: unknown;
}

const store = new Map<string, Entry>();
const loading = new Map<string, Promise<unknown>>();

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.value as T;

  const pending = loading.get(key);
  if (pending) return pending as Promise<T>;

  const promise = (async () => {
    try {
      const value = await load();
      store.delete(key); // re-insert, so the Map's order is least-recently-loaded first
      store.set(key, { at: Date.now(), value });
      if (store.size > MAX_ENTRIES) {
        const oldest = store.keys().next().value;
        if (oldest !== undefined) store.delete(oldest);
      }
      return value;
    } catch (err) {
      if (hit && Date.now() - hit.at < STALE_MS) return hit.value as T;
      throw err;
    } finally {
      loading.delete(key);
    }
  })();
  loading.set(key, promise);
  return promise;
}

/** Drops a cached value, so the next request loads it fresh (after a change the admin just saved). */
export function invalidate(key: string): void {
  store.delete(key);
}
