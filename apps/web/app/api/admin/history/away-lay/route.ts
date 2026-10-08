import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { fetchAwayLayTest } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEYS = ["min", "max", "commission", "spread", "seasons", "divs"];

/** Away Win Lay tested on past seasons (admin only). Query: min, max, commission, spread, seasons, divs. */
export async function GET(request: Request) {
  if (!(await verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const from = new URL(request.url).searchParams;
  const q = new URLSearchParams();
  for (const k of KEYS) {
    const v = from.get(k);
    if (v !== null) q.set(k, v.slice(0, 300));
  }
  try {
    return NextResponse.json(await fetchAwayLayTest(q.toString()));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
