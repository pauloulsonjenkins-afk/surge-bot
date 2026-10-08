import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { fetchHistory } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** League profiles from past seasons (admin only). ?seasons=1..6 */
export async function GET(request: Request) {
  if (!(await verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const seasons = Number(new URL(request.url).searchParams.get("seasons")) || 6;
  try {
    return NextResponse.json(await fetchHistory(seasons));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
