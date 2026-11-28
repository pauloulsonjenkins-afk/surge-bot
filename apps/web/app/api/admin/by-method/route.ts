import { NextResponse } from "next/server";
import { fetchByMethod } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

// Signed-in only: this holds stakes and profit figures.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bets placed by hand against bets GoalBrew placed itself, by period (admin only). */
export async function GET() {
  if (!isAdmin()) return unauthorized();
  try {
    return NextResponse.json(await fetchByMethod());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
