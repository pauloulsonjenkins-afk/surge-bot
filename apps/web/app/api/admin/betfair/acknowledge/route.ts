import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { acknowledgeBets } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Body: { betIds: string[], acknowledged: boolean }. Acknowledge unlinked bets (or put them back) on the Reconcile page. */
export async function POST(request: Request) {
  if (!(await verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { betIds?: unknown; acknowledged?: unknown };
  const betIds = Array.isArray(body.betIds) ? body.betIds.filter((x): x is string => typeof x === "string") : [];
  if (betIds.length === 0 || typeof body.acknowledged !== "boolean") {
    return NextResponse.json({ error: "betIds and acknowledged are required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await acknowledgeBets(betIds, body.acknowledged));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
