import { NextResponse } from "next/server";
import { fetchPickDetail } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One pick in detail for the Trade Log: times, goals, the stats at the alert. Admin only (the stats hint at the rules). */
export async function GET(request: Request) {
  if (!(await isAdmin())) return unauthorized();
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  try {
    return NextResponse.json(await fetchPickDetail(id));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
