import { NextResponse } from "next/server";
import { getClashCheck } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ?strategy=X: how X's picks met what is Live now over the last 30 days, before it goes Live (admin only). */
export async function GET(request: Request) {
  if (!(await isAdmin())) return unauthorized();
  const strategy = new URL(request.url).searchParams.get("strategy");
  if (!strategy) return NextResponse.json({ error: "Which strategy?" }, { status: 400 });
  try {
    return NextResponse.json(await getClashCheck(strategy));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't run the clash check." }, { status: 502 });
  }
}
