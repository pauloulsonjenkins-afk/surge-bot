export class ApiFetchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * GET a JSON endpoint on this site; throws ApiFetchError (with the HTTP status) on failure.
 * Pass React Query's `signal` so a request is cancelled when its data is no longer wanted
 * (the page changed, or a newer filter replaced it).
 */
export async function getJson<T>(url: string, what: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiFetchError(body?.error ?? `Failed to load ${what} (${res.status})`, res.status);
  }
  return (await res.json()) as T;
}