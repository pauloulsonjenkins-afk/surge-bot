import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "./auth";
import { USER_COOKIE_NAME, readUserToken } from "./user-auth";
import { fetchPublicView } from "./engine-client";
import { engineSessionUser, type EngineUser } from "./users-client";
import type { UserPage } from "@/lib/user-pages";

let cache: { at: number; value: boolean } | null = null;

/** Drops the remembered answer, so a switch change takes effect straight away on this server. */
export function forgetPublicViewCache(): void {
  cache = null;
}

export async function publicViewOn(): Promise<boolean> {
  if (cache && Date.now() - cache.at < 3000) return cache.value;
  let value = false; // if the engine can't be asked, stay private
  try {
    value = await fetchPublicView();
  } catch {
    value = false;
  }
  cache = { at: Date.now(), value };
  return value;
}

export async function isAdmin(): Promise<boolean> {
  return verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value);
}

/** The signed-in website user, or null (no cookie, a bad cookie, or an account that was disabled or signed out). */
export async function currentUser(): Promise<EngineUser | null> {
  const session = readUserToken((await cookies()).get(USER_COOKIE_NAME)?.value);
  if (!session) return null;
  return engineSessionUser(session.userId, session.sessionVersion);
}

/**
 * Who may see a page group's data:
 *  - the admin, always;
 *  - anyone, while the Public view switch (Admin > Settings) is on;
 *  - otherwise a signed-in user the admin has given that page.
 * Returns null when allowed, or the reply to send back: 401 = not signed in, 403 = signed in without access.
 */
export async function dataGate(page: UserPage): Promise<NextResponse | null> {
  if (await isAdmin()) return null;
  if (await publicViewOn()) return null;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!user.pages.includes(page)) return NextResponse.json({ error: "no_access" }, { status: 403 });
  return null;
}
