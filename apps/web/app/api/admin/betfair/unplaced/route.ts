import { NextResponse } from "next/server";
import { clearUnplaced, fetchUnplaced } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sent picks with no bet on Betfair 3 minutes after sending, last 24 hours. Admin only. */
export async function GET() {
  if (!(await isAdmin())) {
    return unauthorized();
  }
  try {
    return NextResponse.json(await fetchUnplaced());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}

/** Clears reviewed picks from the list: { ids }. Admin only. */
export async function POST(req: Request) {
  if (!(await isAdmin())) {
    return unauthorized();
  }
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is number => Number.isInteger(x)) : [];
  if (ids.length === 0) return NextResponse.json({ error: "No picks given to clear." }, { status: 400 });
  try {
    return NextResponse.json(await clearUnplaced(ids));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
