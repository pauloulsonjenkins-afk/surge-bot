import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { addMatchName } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Body: { from: alert's team name, to: Betfair's }. Adds it to the Sending page's Match names (admin only). */
export async function POST(request: Request) {
  if (!(await verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { from?: unknown; to?: unknown };
  if (typeof body.from !== "string" || typeof body.to !== "string") return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  try {
    return NextResponse.json(await addMatchName(body.from, body.to));
  } catch (err) {
    // The engine's reason ("The two names are the same.") is written for the admin, so it is passed on.
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 400 });
  }
}
