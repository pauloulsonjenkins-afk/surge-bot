import { NextResponse } from "next/server";
import { fetchDripShadow } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

// Signed-in only. No page links here: the drip shadow test is read from this address.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isAdmin()) return unauthorized();
  try {
    return NextResponse.json(await fetchDripShadow());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
