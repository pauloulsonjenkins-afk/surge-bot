import { NextResponse } from "next/server";
import { fixUnplaced } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A Not placed pick whose team Betfair spells differently: adds Betfair's spelling to Match names and sends the bet
 * again under Betfair's event name. Body: { id }. Admin only (also called from the notification's button).
 */
export async function POST(req: Request) {
  if (!(await isAdmin())) {
    return unauthorized();
  }
  const body = (await req.json().catch(() => ({}))) as { id?: unknown };
  if (!Number.isInteger(body.id)) return NextResponse.json({ error: "No pick given." }, { status: 400 });
  try {
    return NextResponse.json(await fixUnplaced(body.id as number));
  } catch (err) {
    // The engine's reason ("That pick already has a bet.") is written for the admin, so it is passed on.
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 400 });
  }
}
