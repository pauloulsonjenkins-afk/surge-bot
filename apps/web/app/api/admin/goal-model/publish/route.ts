import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { publishGoalModel } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Trains the goal model on everything settled and freezes it as the next version (admin only). */
export async function POST() {
  if (!(await verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await publishGoalModel());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 400 });
  }
}
