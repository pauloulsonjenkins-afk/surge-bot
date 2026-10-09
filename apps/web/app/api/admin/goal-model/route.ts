import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { fetchGoalModel } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The goal model research report (admin only). ?refresh=1 trains it again now. */
export async function GET(request: Request) {
  if (!(await verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await fetchGoalModel(new URL(request.url).searchParams.get("refresh") === "1"));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
