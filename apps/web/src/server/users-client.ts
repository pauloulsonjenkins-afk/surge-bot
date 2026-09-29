/**
 * Server-only calls to the engine's /internal/users routes (never imported into client code).
 * The engine does the password hashing and holds the user list; this site only passes things along.
 */
import type { UserPage } from "@/lib/user-pages";

export interface EngineUser {
  id: number;
  email: string;
  name: string;
  pages: UserPage[];
  active: boolean;
  sessionVersion: number;
  createdAt: string;
  lastLoginAt: string | null;
}

/** What the browser is allowed to know about a user (no session version). */
export interface ClientUser {
  id: number;
  email: string;
  name: string;
  pages: UserPage[];
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export function toClientUser(u: EngineUser): ClientUser {
  return { id: u.id, email: u.email, name: u.name, pages: u.pages, active: u.active, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt };
}

async function usersRequest<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${internalKey}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
    if (res.status >= 500) throw new Error(`Engine responded ${res.status} for ${path}.`);
    return { status: res.status, data: (await res.json().catch(() => ({}))) as T };
  } finally {
    clearTimeout(timeout);
  }
}

export const engineSignUp = (input: { email: string; name: string; password: string }) =>
  usersRequest<{ ok?: true; error?: string }>("POST", "/internal/users/signup", input);

export const engineLogIn = (input: { email: string; password: string }) =>
  usersRequest<{ user?: EngineUser; error?: string }>("POST", "/internal/users/login", input);

export const engineListUsers = () => usersRequest<{ users: EngineUser[]; signupsOpen: boolean }>("GET", "/internal/users");

export const engineUpdateUser = (body: Record<string, unknown>) =>
  usersRequest<{ user?: EngineUser; error?: string }>("POST", "/internal/users/update", body);

export const engineDeleteUser = (id: number) => usersRequest<{ ok?: true; error?: string }>("POST", "/internal/users/delete", { id });

export const engineSetSignupsOpen = (signupsOpen: boolean) =>
  usersRequest<{ signupsOpen?: boolean; error?: string }>("POST", "/internal/users/settings", { signupsOpen });

// A signed-in user is re-checked against the engine so a disabled account or changed access takes effect
// within a few seconds. The answer is remembered briefly so a page's several requests make one engine call.
const sessionCache = new Map<string, { at: number; user: EngineUser | null }>();
const SESSION_TTL_MS = 4000;

export function forgetUserSessions(): void {
  sessionCache.clear();
}

export async function engineSessionUser(id: number, sessionVersion: number): Promise<EngineUser | null> {
  const key = `${id}:${sessionVersion}`;
  const hit = sessionCache.get(key);
  if (hit && Date.now() - hit.at < SESSION_TTL_MS) return hit.user;
  let user: EngineUser | null = null;
  try {
    const r = await usersRequest<{ user?: EngineUser }>("GET", `/internal/users/session?id=${id}&sv=${sessionVersion}`);
    user = r.status === 200 && r.data.user ? r.data.user : null;
  } catch {
    user = null; // if the engine can't be asked, stay closed
  }
  if (sessionCache.size > 500) sessionCache.clear();
  sessionCache.set(key, { at: Date.now(), user });
  return user;
}
