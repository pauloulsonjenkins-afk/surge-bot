import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "./auth";
import { fetchPublicView } from "./engine-client";

let cache: { at: number; value: boolean } | null = null;

/** Drops the remembered answer, so a switch change takes effect straight away on this server. */
export function forgetPublicViewCache(): void {
  cache = null;
}

async function publicViewOn(): Promise<boolean> {
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

/** Signed-in admins can always see the data; everyone else only while the public view switch is on. */
export async function canViewData(): Promise<boolean> {
  if (await verifySessionToken(cookies().get(ADMIN_COOKIE_NAME)?.value)) return true;
  return publicViewOn();
}
