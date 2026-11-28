import { NextResponse } from "next/server";
import { fetchHistory } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** League profiles from past seasons (admin only). ?seasons=1..6 */
export async function GET(request: Request) {
  if (!(await isAdmin())) return unauthorized();
  const seasons = Number(new URL(request.url).searchParams.get("seasons")) || 6;
  try {
    return NextResponse.json(await fetchHistory(seasons));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
