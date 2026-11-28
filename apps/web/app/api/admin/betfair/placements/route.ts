import { NextResponse } from "next/server";
import { fetchPlacements } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether each recently sent pick was placed and matched on Betfair. Admin only: it shows stakes and prices. */
export async function GET() {
  if (!(await isAdmin())) {
    return unauthorized();
  }
  try {
    return NextResponse.json(await fetchPlacements());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
