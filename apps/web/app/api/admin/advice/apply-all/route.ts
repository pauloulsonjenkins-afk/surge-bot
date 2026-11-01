import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { applyAllStrategyAdvice } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Carries out every suggestion showing on Today and Strategies in one go (admin only). League stops are left out. */
export async function POST() {
  if (!(await verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await applyAllStrategyAdvice());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't apply them." }, { status: 400 });
  }
}
