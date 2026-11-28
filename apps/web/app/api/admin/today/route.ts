import { NextResponse } from "next/server";
import { fetchToday } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Everything the Today page shows, in one call (admin only). */
export async function GET() {
  if (!(await isAdmin())) return unauthorized();
  try {
    return NextResponse.json(await fetchToday());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
