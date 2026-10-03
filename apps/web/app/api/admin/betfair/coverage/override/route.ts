import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { setLeagueOverride } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Body: { league, competition: a Betfair competition's name | "none" | null }. Matches a league by hand (admin only). */
export async function POST(request: Request) {
  if (!(await verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { league?: unknown; competition?: unknown };
  if (typeof body.league !== "string" || (body.competition !== null && typeof body.competition !== "string")) {
    return NextResponse.json({ error: "league and competition are required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await setLeagueOverride(body.league, body.competition));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 400 });
  }
}
