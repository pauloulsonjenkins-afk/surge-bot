import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { chooseBetfairMatch } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Body: { id, event }. A pick not found on Betfair: use one of the events Betfair offered for it (admin only). */
export async function POST(request: Request) {
  if (!(await verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
