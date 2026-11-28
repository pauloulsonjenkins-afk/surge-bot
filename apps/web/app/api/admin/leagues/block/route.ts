import { NextResponse } from "next/server";
import { setStrategyLeagueBlock } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Body: { strategy, leagueKey, league, blocked }. Stops or restarts a strategy in one league (admin only). */
export async function POST(request: Request) {
  if (!(await isAdmin())) return unauthorized();
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.strategy !== "string" || typeof b.leagueKey !== "string" || typeof b.league !== "string" || typeof b.blocked !== "boolean")
    return NextResponse.json({ error: "Which strategy and league?" }, { status: 400 });
  try {
    return NextResponse.json(await setStrategyLeagueBlock({ strategy: b.strategy, leagueKey: b.leagueKey, league: b.league, blocked: b.blocked }));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't change that." }, { status: 502 });
  }
}
