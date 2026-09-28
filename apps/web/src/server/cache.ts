/**
 * A tiny in-memory cache for the public data routes, so many people (or one
 * person with several tabs open) don't each make the engine do the work again
 * within a few seconds.
 */
const store = new Map<string, { at: number; value: unknown }>();

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  store.set(key, { at: now, value });
  if (store.size > 50) {
    const oldest = [...store.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) store.delete(oldest[0]);
  }
  return value;
}
