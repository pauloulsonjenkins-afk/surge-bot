/**
 * Server-only call to the engine's /internal/picks endpoint.
 *
 * Never imported into client code — ENGINE_BASE_URL and ADMIN_INTERNAL_KEY
 * stay on the server, same principle as auth.ts and ADMIN_PASSWORD.
 */

export interface EnginePick {
  id: number;
  receivedAt: string;
  bodySha256: string;
  contentType: string | null;
  signatureVerified: boolean;
  body: string;
}

export async function fetchRecentPicks(limit = 50): Promise<EnginePick[]> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error(
      "ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component " +
        "(ADMIN_INTERNAL_KEY must match the same value set on the engine component).",
    );
  }

  const res = await fetch(`${baseUrl}/internal/picks?limit=${limit}`, {
    headers: { Authorization: `Bearer ${internalKey}` },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Engine responded ${res.status} when fetching picks.`);
  }

  const data = (await res.json()) as { picks: EnginePick[] };
  return data.picks;
}
