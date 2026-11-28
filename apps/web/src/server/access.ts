import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "./auth";
import { fetchPublicView } from "./engine-client";

let cache: { at: number; value: boolean } | null = null;

/** Drops the remembered answer, so a switch change takes effect straight away on this server. */
export function forgetPublicViewCache(): void {
  cache = null;
}

export async function publicViewOn(): Promise<boolean> {
  if (cache && Date.now() - cache.at < 10_000) return cache.value;
  let value = false; // if the engine can't be asked, stay private
  try {
    value = await fetchPublicView();
  } catch {
    value = false;
  }
  cache = { at: Date.now(), value };
  return value;
}

/** Whether this request carries a valid admin session. */
export async function isAdmin(): Promise<boolean> {
  return verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value);
}

/** The reply for a request without an admin session. */
export const unauthorized = () => NextResponse.json({ error: "unauthorized" }, { status: 401 });

/**
 * Who may see the Dashboard, Live, Trade Log and Schedule data: the admin, or anyone while Public view (Admin > Settings)
 * is on. Returns null when allowed, or the 401 to send back.
 */
export async function dataGate(): Promise<NextResponse | null> {
  if ((await isAdmin()) || (await publicViewOn())) return null;
  return unauthorized();
}
