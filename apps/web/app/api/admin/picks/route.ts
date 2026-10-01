import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { fetchRecentPicks } from "@/server/engine-client";

// Force the Node.js runtime (not Edge): Edge functions can't reach the
// app's internal DigitalOcean networking, which is why fetch() to the
// engine's internal address was hanging until the platform's own timeout.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
  if (!(await verifySessionToken(token))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50;

  try {
    const picks = await fetchRecentPicks(limit);
    return NextResponse.json({ picks });
  } catch (err) {
    console.log(`[picks] route caught: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown_error" },
      { status: 502 },
    );
  }
}
