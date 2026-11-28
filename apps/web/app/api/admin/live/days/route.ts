import { NextResponse } from "next/server";
import { fetchPickDays } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

// Signed-in only. The days that have picks, for the Results page's date picker.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) {
    return unauthorized();
  }
  try {
    return NextResponse.json({ days: await fetchPickDays() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
