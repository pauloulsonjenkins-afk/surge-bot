import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { fetchByMethod } from "@/server/engine-client";

// Signed-in only: this holds stakes and profit figures.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bets placed by hand against bets GoalBrew placed itself, by period (admin only). */
export async function GET() {
  if (!verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await fetchByMethod());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
