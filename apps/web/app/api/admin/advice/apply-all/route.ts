import { NextResponse } from "next/server";
import { applyAllStrategyAdvice } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Carries out every suggestion showing on Today and Strategies in one go (admin only). League stops are left out. */
export async function POST() {
  if (!(await isAdmin())) return unauthorized();
  try {
    return NextResponse.json(await applyAllStrategyAdvice());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't apply them." }, { status: 400 });
  }
}
