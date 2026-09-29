import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { fetchLivePicks, toAdminPick, type PickWindow } from "@/server/engine-client";

// Signed-in only. Used by the Results page, which needs a little more than the public view.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await verifySessionToken(cookies().get(ADMIN_COOKIE_NAME)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get("limit"));
  // ?hours=24 = the last 24 hours; ?date=YYYY-MM-DD = one UK day. Either allows a bigger list.
  const hours = Number(searchParams.get("hours"));
  const date = searchParams.get("date") ?? "";
  let window: PickWindow = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) window = { date };
  else if (Number.isFinite(hours) && hours > 0) window = { hours: Math.min(Math.floor(hours), 24 * 31) };
  const max = window ? 1000 : 200;
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), max) : window ? 1000 : 50;
  try {
    return NextResponse.json({ picks: (await fetchLivePicks(limit, window)).map(toAdminPick) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}