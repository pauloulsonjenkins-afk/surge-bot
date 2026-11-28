import { NextResponse } from "next/server";
import { chooseBetfairMatch } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Body: { id, event }. A pick not found on Betfair: use one of the events Betfair offered for it (admin only). */
export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return unauthorized();
  }
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; event?: unknown };
  if (typeof body.id !== "number" || typeof body.event !== "string") return NextResponse.json({ error: "id and event are required" }, { status: 400 });
  try {
    return NextResponse.json(await chooseBetfairMatch(body.id, body.event));
  } catch (err) {
    // The engine's reason is written for the admin, so it is passed on.
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 400 });
  }
}
