import { NextResponse } from "next/server";
import { refreshHistory } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Downloads this season's files again now (admin only). */
export async function POST() {
  if (!(await isAdmin())) return unauthorized();
  try {
    return NextResponse.json(await refreshHistory());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
