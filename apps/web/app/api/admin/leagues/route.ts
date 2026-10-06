import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { fetchAdminLeagues, updateAdminLeague, type LeaguePatch } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function isAdmin(): Promise<boolean> {
  const token = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ leagues: await fetchAdminLeagues() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key) return NextResponse.json({ error: "key_required" }, { status: 400 });

  const patch: LeaguePatch = {};
  if (typeof body.hidden === "boolean") patch.hidden = body.hidden;
  if (typeof body.reset === "boolean") patch.reset = body.reset;
  if (typeof body.country === "string" || body.country === null) patch.country = body.country;
  if (typeof body.tier === "number" || body.tier === null) patch.tier = body.tier;
  if (typeof body.noSend === "boolean") patch.noSend = body.noSend;
  if (typeof body.keep === "boolean") patch.keep = body.keep;
  if (typeof body.ipgDone === "boolean") patch.ipgDone = body.ipgDone;

  try {
    await updateAdminLeague(key, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
