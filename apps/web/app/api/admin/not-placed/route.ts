import { NextResponse } from "next/server";
import { fetchNotPlaced } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Picks handed over to bet that never got a matched Betfair bet, grouped by why (admin only). ?days=1..365 */
export async function GET(request: Request) {
  if (!(await isAdmin())) return unauthorized();
  const days = Number(new URL(request.url).searchParams.get("days")) || 30;
  try {
    return NextResponse.json(await fetchNotPlaced(days));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
