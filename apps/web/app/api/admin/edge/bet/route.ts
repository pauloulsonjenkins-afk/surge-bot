import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { valueBets } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const authorised = async () => verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value);

/** Body: { pickId, stake }. Hands one value pick to GoalBrew's direct betting, which places it with its usual checks (admin only). */
export async function POST(request: Request) {
  if (!(await authorised())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { pickId?: unknown; stake?: unknown };
  const pickId = Number(body.pickId);
  const stake = Number(body.stake);
  if (!Number.isInteger(pickId) || !Number.isFinite(stake)) return NextResponse.json({ error: "Which bet, and what stake?" }, { status: 400 });
  try {
    return NextResponse.json(await valueBets({ pickId, stake }));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't place that." }, { status: 400 });
  }
}
