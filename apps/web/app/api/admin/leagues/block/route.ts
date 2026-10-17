import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { setStrategyLeagueBlock } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Body: { strategy, leagueKey, league, blocked }. Stops or restarts a strategy in one league (admin only). */
export async function POST(request: Request) {
  if (!(await verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.strategy !== "string" || typeof b.leagueKey !== "string" || typeof b.league !== "string" || typeof b.blocked !== "boolean")
    return NextResponse.json({ error: "Which strategy and league?" }, { status: 400 });
  try {
    return NextResponse.json(await setStrategyLeagueBlock({ strategy: b.strategy, leagueKey: b.leagueKey, league: b.league, blocked: b.blocked }));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't change that." }, { status: 502 });
  }
}
