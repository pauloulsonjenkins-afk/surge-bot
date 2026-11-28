import { NextResponse } from "next/server";
import { retryBet } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Body: { pickId }. Retries a bet that wasn't placed, while its alert is still fresh enough to bet (admin only). */
export async function POST(request: Request) {
  if (!(await isAdmin())) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as { pickId?: unknown };
  const pickId = Number(body.pickId);
  if (!Number.isInteger(pickId)) return NextResponse.json({ error: "Which pick?" }, { status: 400 });
  try {
    return NextResponse.json(await retryBet(pickId));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't retry that." }, { status: 400 });
  }
}
