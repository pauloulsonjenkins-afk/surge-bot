import { NextResponse } from "next/server";
import { fetchAwayLayTest } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEYS = ["min", "max", "commission", "spread", "seasons", "divs"];

/** Away Win Lay tested on past seasons (admin only). Query: min, max, commission, spread, seasons, divs. */
export async function GET(request: Request) {
  if (!(await isAdmin())) return unauthorized();
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
