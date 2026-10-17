import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { betPickNow } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Body: { pickId }. Bets a Sim pick for real now, at its strategy's stake (admin only). */
export async function POST(request: Request) {
  if (!(await verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { pickId?: unknown };
  const pickId = Number(body.pickId);
  if (!Number.isInteger(pickId)) return NextResponse.json({ error: "Which pick?" }, { status: 400 });
  try {
    return NextResponse.json(await betPickNow(pickId));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't bet that." }, { status: 400 });
  }
}
