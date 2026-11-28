import { NextResponse } from "next/server";
import { setManualBet } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Body: { id, stake, odds } to log a bet placed by hand on a pick, or { id, clear: true } to remove it. */
export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return unauthorized();
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
