import { NextResponse } from "next/server";
import { getStrategyAdvice } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The strategy suggestions on their own, for the menus' count badge (admin only). */
export async function GET() {
  if (!(await isAdmin())) return unauthorized();
  try {
    return NextResponse.json(await getStrategyAdvice());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't load the suggestions." }, { status: 502 });
  }
}
