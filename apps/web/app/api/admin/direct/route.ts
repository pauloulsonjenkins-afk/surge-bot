import { NextResponse } from "next/server";
import { fetchDirect, saveDirect, type DirectSettings } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

// Admin only. Direct betting: GoalBrew placing bets on Betfair itself (engine: betfair/direct.ts).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) return unauthorized();
  try {
    return NextResponse.json(await fetchDirect());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}

export async function PUT(request: Request) {
  if (!(await isAdmin())) return unauthorized();
  const body = (await request.json().catch(() => null)) as Partial<DirectSettings> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid body" }, { status: 400 });
  try {
    return NextResponse.json(await saveDirect(body));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 400 });
  }
}
