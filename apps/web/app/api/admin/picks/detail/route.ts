import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { fetchPickDetail } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One pick in detail for the Trade Log: times, goals, the stats at the alert. Admin only (the stats hint at the rules). */
export async function GET(request: Request) {
  if (!(await verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  try {
    return NextResponse.json(await fetchPickDetail(id));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
