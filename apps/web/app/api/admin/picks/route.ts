import { NextResponse } from "next/server";
import { fetchRecentPicks } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The raw alerts as received (Results > Raw alerts). */
export async function GET(request: Request) {
  if (!(await isAdmin())) return unauthorized();
  const limitParam = Number(new URL(request.url).searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50;
  try {
    return NextResponse.json({ picks: await fetchRecentPicks(limit) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
