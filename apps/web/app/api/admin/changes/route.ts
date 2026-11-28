import { NextResponse } from "next/server";
import { fetchChanges } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

// Signed-in only: the changes log (who switched or re-staked what, and when).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isAdmin()) return unauthorized();
  try {
    return NextResponse.json(await fetchChanges());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
