import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { fetchGolden, goldenAction } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function isAdmin() {
  return verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value);
}

/** Golden: watched slices and the finder's suggestions (admin only). */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await fetchGolden());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}

/**
 * Body: { action: "watch", strategyKey, rule }, { action: "unwatch", strategyKey, id }, { action: "notify", strategyKey,
 * id, on } (a slice's alert notifications; also the notification's own Mute button) or { action: "quiet", quiet }.
 */
export async function POST(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (b.action === "quiet" && typeof b.quiet === "boolean") return NextResponse.json(await goldenAction({ action: "quiet", quiet: b.quiet }));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't change that." }, { status: 400 });
  }
  if (typeof b.strategyKey !== "string") return NextResponse.json({ error: "Which strategy?" }, { status: 400 });
  try {
    if (b.action === "notify" && typeof b.id === "string" && typeof b.on === "boolean") return NextResponse.json(await goldenAction({ action: "notify", strategyKey: b.strategyKey, id: b.id, on: b.on }));
    if (b.action === "watch" && Array.isArray(b.rule)) return NextResponse.json(await goldenAction({ action: "watch", strategyKey: b.strategyKey, rule: b.rule.map(String) }));
    if (b.action === "unwatch" && typeof b.id === "string") return NextResponse.json(await goldenAction({ action: "unwatch", strategyKey: b.strategyKey, id: b.id }));
    return NextResponse.json({ error: "What should change?" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't change that." }, { status: 400 });
  }
}
