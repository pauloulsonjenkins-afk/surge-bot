import { NextResponse } from "next/server";
import { forMember } from "@/server/members-client";
import { currentUser } from "@/server/access";
import { clientIp, overLimit } from "@/server/throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Members platform's API for the signed-in member. Only these paths are passed on; the engine decides what the
 * member may see or do. Changes are rate limited per member and per address.
 */
const GETS = new Set(["me", "plans", "dashboard", "strategies", "strategy", "upcoming", "edge", "history", "performance", "settings", "automation", "notifications", "community", "community/strategy"]);
const POSTS = new Set([
  "trial/start",
  "follow",
  "settings",
  "settings/reset-sim",
  "simulate",
  "notifications/read",
  "event",
  "billing/checkout",
  "billing/portal",
  "betfair/connect",
  "betfair/test",
  "betfair/disconnect",
  "live",
  "live/stop",
  "community/create",
  "community/update",
  "community/delete",
]);
/** Query parameters the engine reads; anything else is dropped. */
const PARAMS = ["key", "mode", "strategy", "from", "to", "result", "execution", "page", "range", "id"];

type Params = { params: Promise<{ path: string[] }> };

export async function GET(req: Request, { params }: Params) {
  const path = (await params).path.join("/");
  if (!GETS.has(path)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const q = new URL(req.url).searchParams;
  const keep = new URLSearchParams();
  for (const k of PARAMS) {
    const v = q.get(k);
    if (v !== null) keep.set(k, v.slice(0, 120));
  }
  const qs = keep.toString();
  return forMember("GET", qs ? `${path}?${qs}` : path);
}

export async function POST(req: Request, { params }: Params) {
  const path = (await params).path.join("/");
  if (!POSTS.has(path)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  // Generous for normal use, tight enough to stop scripted abuse. Trial starts and payments are tighter still.
  const tight = path === "trial/start" || path.startsWith("billing/") || path.startsWith("betfair/") || path === "live";
  if (overLimit(`members:${user.id}:${tight ? "tight" : "all"}`, tight ? 10 : 120, tight ? 10 * 60_000 : 60_000) || overLimit(`members:ip:${clientIp(req)}`, 300, 60_000)) {
    return NextResponse.json({ error: "Too many requests. Wait a minute and try again." }, { status: 429 });
  }
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  return forMember("POST", path, body);
}
