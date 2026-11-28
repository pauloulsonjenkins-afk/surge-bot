import { NextResponse } from "next/server";
import { fetchLeagueForm } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Each strategy's verdict in each league and the league-filter backtest (engine server/league-form.ts). */
export async function GET() {
  if (!(await isAdmin())) return unauthorized();
  try {
    return NextResponse.json(await fetchLeagueForm());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
