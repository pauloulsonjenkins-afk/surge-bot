import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_COOKIE_NAME,
  ADMIN_SESSION_MAX_AGE,
  checkPassword,
  createSessionToken,
} from "@/server/auth";

// Small in-memory throttle so a script can't hammer the login route. Resets on deploy/restart,
// which is fine for a solo-admin gate.
//  - Per address: 8 tries per 5 minutes.
//  - Overall: 40 tries per 5 minutes from everyone together, so changing the address a request
//    claims to come from (a forged X-Forwarded-For header) can't get round the limit.
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const MAX_ATTEMPTS_ALL = 40;
let all = { count: 0, resetAt: 0 };

/**
 * The caller's address. DigitalOcean's edge sets DO-Connecting-IP; otherwise the LAST
 * X-Forwarded-For entry, which is the one the proxy added. The first entries are whatever the
 * client chose to send, so they can't be trusted.
 */
function clientIp(req: NextRequest): string {
  const direct = req.headers.get("do-connecting-ip")?.trim();
  if (direct) return direct;
  const hops = (req.headers.get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return hops[hops.length - 1] ?? "unknown";
}

function throttled(ip: string): boolean {
  const now = Date.now();
  if (now > all.resetAt) all = { count: 0, resetAt: now + WINDOW_MS };
  all.count += 1;

  // Drop expired entries so the map can't grow without limit.
  if (attempts.size > 1000) for (const [k, v] of attempts) if (now > v.resetAt) attempts.delete(k);

  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return all.count > MAX_ATTEMPTS_ALL;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS || all.count > MAX_ATTEMPTS_ALL;
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);

  if (throttled(ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a few minutes." },
      { status: 429 }
    );
  }

  let password: unknown;
  try {
    const body = await req.json();
    password = body?.password;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (typeof password !== "string" || password.length === 0) {
    return NextResponse.json({ error: "Password required." }, { status: 400 });
  }

  let ok = false;
  try {
    ok = await checkPassword(password);
  } catch (err) {
    // Missing env vars, not a bad password — surface clearly server-side.
    console.error("[admin/session] config error:", (err as Error).message);
    return NextResponse.json(
      { error: "Admin auth isn't configured yet. Check server env vars." },
      { status: 500 }
    );
  }

  if (!ok) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const token = await createSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return res;
}