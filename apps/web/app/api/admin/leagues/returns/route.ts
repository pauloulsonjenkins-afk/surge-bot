import { NextResponse } from "next/server";
import { fetchLeagueReturns } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Leagues → Profit: money by league and by strategy within each (admin only). ?since= limits the period. */
export async function GET(request: Request) {
  if (!(await isAdmin())) return unauthorized();
  const since = new URL(request.url).searchParams.get("since");
  try {
    return NextResponse.json(await fetchLeagueReturns(since));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
