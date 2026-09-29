/**
 * Website user sessions (separate from the admin session in auth.ts).
 *
 * After a correct email and password the server sets an httpOnly cookie holding
 * { user id, session version, expiry } signed with HMAC-SHA256. The browser can't read or forge it.
 * The session version lives on the user's record in the engine, so an admin disabling the user,
 * resetting their password or pressing "Sign out everywhere" ends every existing sign-in at once.
 *
 * The signature covers a "user-session:" prefix, so this cookie can never be mistaken for an admin one.
 * It reuses ADMIN_SESSION_SECRET, so there is nothing new to configure.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const USER_COOKIE_NAME = "gb_user_session";
export const USER_SESSION_MAX_AGE = 60 * 60 * 24 * 14; // 14 days

function secret(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("ADMIN_SESSION_SECRET is missing or too short.");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(`user-session:${payload}`).digest("base64url");
}

export function createUserToken(userId: number, sessionVersion: number): string {
  const exp = Math.floor(Date.now() / 1000) + USER_SESSION_MAX_AGE;
  const payload = Buffer.from(JSON.stringify({ u: userId, v: sessionVersion, e: exp })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** The user id and session version in a valid, unexpired cookie; null for anything else. Never throws. */
export function readUserToken(token: string | undefined | null): { userId: number; sessionVersion: number } | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const expected = Buffer.from(sign(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u?: unknown; v?: unknown; e?: unknown };
    if (!Number.isInteger(data.u) || !Number.isInteger(data.v) || typeof data.e !== "number") return null;
    if (data.e < Math.floor(Date.now() / 1000)) return null;
    return { userId: data.u as number, sessionVersion: data.v as number };
  } catch {
    return null;
  }
}
