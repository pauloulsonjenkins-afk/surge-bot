/**
 * Website users: sign-up, sign-in and which pages each person may see.
 *
 * - Passwords are never stored, only salted scrypt hashes. The website never sees a hash.
 * - New sign-ups start with NO page access. The admin switches pages on from the Users page.
 * - "Pages" are three groups, matching the three data sources behind the site:
 *     dashboard  Dashboard and Strategies (hit-rate figures)
 *     live       Live and Trade Log       (the alerts themselves)
 *     schedule   Schedule                 (fixtures)
 * - Admin pages are not part of this: they stay behind the admin password.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { AppUserRow, EngineDb } from "../storage/engine-db";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

export const USER_PAGES = ["dashboard", "live", "schedule"] as const;
export type UserPage = (typeof USER_PAGES)[number];

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 200;

const SIGNUPS_KEY = "user_signups";
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export interface PublicUser {
  id: number;
  email: string;
  name: string;
  pages: UserPage[];
  active: boolean;
  sessionVersion: number;
  createdAt: string;
  lastLoginAt: string | null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  try {
    const expected = Buffer.from(hashB64, "base64");
    const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// A real hash of a throwaway password, so a sign-in for an email that doesn't exist takes as long as one that does.
let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(12).toString("hex"));
  return dummyHash;
}

export function normaliseEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (email.length < 5 || email.length > 254) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function passwordProblem(input: unknown): string | null {
  if (typeof input !== "string" || input.length < MIN_PASSWORD) return `Use a password of at least ${MIN_PASSWORD} characters.`;
  if (input.length > MAX_PASSWORD) return `Use a password of ${MAX_PASSWORD} characters or fewer.`;
  return null;
}

function cleanName(input: unknown): string {
  return typeof input === "string" ? input.replace(/\s+/g, " ").trim().slice(0, 60) : "";
}

export function parsePages(raw: unknown): UserPage[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return USER_PAGES.filter((p) => list.includes(p));
}

export function toPublicUser(row: AppUserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    pages: parsePages(row.pages),
    active: row.active,
    sessionVersion: row.sessionVersion,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
  };
}

export function getSignupsOpen(db: EngineDb): boolean {
  const raw = db.getSetting(SIGNUPS_KEY);
  if (raw === null) return true;
  try {
    return (JSON.parse(raw) as { open?: unknown }).open !== false;
  } catch {
    return false; // a fault can only make sign-up stricter
  }
}

export function setSignupsOpen(db: EngineDb, open: boolean): void {
  db.setSetting(SIGNUPS_KEY, JSON.stringify({ open }));
}

export type SignUpResult = { ok: true } | { ok: false; error: "signups_closed" | "invalid_email" | "weak_password" };

/**
 * Creates an account with no page access. An email that is already registered gets the same
 * "ok" answer, so the form can't be used to find out who has an account.
 */
export async function signUp(db: EngineDb, input: { email: unknown; name: unknown; password: unknown }): Promise<SignUpResult> {
  if (!getSignupsOpen(db)) return { ok: false, error: "signups_closed" };
  const email = normaliseEmail(input.email);
  if (!email) return { ok: false, error: "invalid_email" };
  if (passwordProblem(input.password) !== null) return { ok: false, error: "weak_password" };
  const hash = await hashPassword(input.password as string);
  db.createAppUser(email, cleanName(input.name), hash);
  return { ok: true };
}

export type LogInResult = { ok: true; user: PublicUser } | { ok: false; error: "invalid_credentials" | "disabled" };

export async function logIn(db: EngineDb, input: { email: unknown; password: unknown }): Promise<LogInResult> {
  const email = normaliseEmail(input.email);
  const password = typeof input.password === "string" && input.password.length <= MAX_PASSWORD ? input.password : "";
  const row = email ? db.getAppUserByEmail(email) : null;
  const good = await verifyPassword(password, row ? row.passwordHash : await getDummyHash());
  if (!row || !good) return { ok: false, error: "invalid_credentials" };
  if (!row.active) return { ok: false, error: "disabled" };
  db.touchAppUserLogin(row.id);
  return { ok: true, user: toPublicUser(row) };
}

/** The user behind a website session, or null if they were disabled, deleted or signed out everywhere since. */
export function sessionUser(db: EngineDb, id: number, sessionVersion: number): PublicUser | null {
  const row = db.getAppUserById(id);
  if (!row || !row.active || row.sessionVersion !== sessionVersion) return null;
  return toPublicUser(row);
}

export function listUsers(db: EngineDb): PublicUser[] {
  return db.listAppUsers().map(toPublicUser);
}

export interface UserPatch {
  name?: unknown;
  pages?: unknown;
  active?: unknown;
  password?: unknown;
  signOutEverywhere?: unknown;
}

export type UpdateResult = { ok: true; user: PublicUser } | { ok: false; error: "not_found" | "weak_password" | "bad_request" };

export async function updateUser(db: EngineDb, id: number, patch: UserPatch): Promise<UpdateResult> {
  if (!db.getAppUserById(id)) return { ok: false, error: "not_found" };
  const change: Parameters<EngineDb["updateAppUser"]>[1] = {};
  if (patch.name !== undefined) change.name = cleanName(patch.name);
  if (patch.pages !== undefined) {
    if (!Array.isArray(patch.pages)) return { ok: false, error: "bad_request" };
    change.pages = JSON.stringify(parsePages(patch.pages));
  }
  if (patch.active !== undefined) {
    if (typeof patch.active !== "boolean") return { ok: false, error: "bad_request" };
    change.active = patch.active;
  }
  if (patch.password !== undefined) {
    if (passwordProblem(patch.password) !== null) return { ok: false, error: "weak_password" };
    change.passwordHash = await hashPassword(patch.password as string);
  }
  if (patch.signOutEverywhere === true) change.signOutEverywhere = true;
  db.updateAppUser(id, change);
  const row = db.getAppUserById(id);
  return row ? { ok: true, user: toPublicUser(row) } : { ok: false, error: "not_found" };
}
