import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { getPredictions } from "@/server/footballbin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current FootballBin predictions for the Live tab's featured match (admin only; see server/footballbin.ts). */
export async function GET() {
  if (!(await verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ predictions: await getPredictions() });
}
