import { NextResponse } from "next/server";
import { getPredictions } from "@/server/footballbin";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current FootballBin predictions for the Live tab's featured match (admin only; see server/footballbin.ts). */
export async function GET() {
  if (!(await isAdmin())) return unauthorized();
  return NextResponse.json({ predictions: await getPredictions() });
}
