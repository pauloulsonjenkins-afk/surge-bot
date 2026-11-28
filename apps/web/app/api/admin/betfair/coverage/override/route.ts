import { NextResponse } from "next/server";
import { setLeagueOverride } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Body: { league, competition: a Betfair competition's name | "none" | null }. Matches a league by hand (admin only). */
export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return unauthorized();
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
