import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { getStrategyAdvice } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The strategy suggestions on their own, for the menus' count badge (admin only). */
export async function GET() {
  if (!(await verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await getStrategyAdvice());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't load the suggestions." }, { status: 502 });
  }
}
