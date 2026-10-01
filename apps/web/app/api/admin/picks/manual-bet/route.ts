import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { setManualBet } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Body: { id, stake, odds } to log a bet placed by hand on a pick, or { id, clear: true } to remove it. */
export async function POST(request: Request) {
  if (!(await verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; stake?: unknown; odds?: unknown; clear?: unknown };
  if (typeof body.id !== "number") return NextResponse.json({ error: "id is required" }, { status: 400 });
  try {
    return NextResponse.json(
      await setManualBet(body.id, body.clear === true ? null : { stake: String(body.stake ?? ""), odds: String(body.odds ?? "") }),
    );
  } catch (err) {
    // The engine's reason ("Enter the odds you got...") is written for the admin, so it is passed on.
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 400 });
  }
}
