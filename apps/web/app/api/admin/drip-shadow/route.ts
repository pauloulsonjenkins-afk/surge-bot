import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { fetchDripShadow } from "@/server/engine-client";

// Signed-in only. No page links here: the drip shadow test is read from this address.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await fetchDripShadow());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
