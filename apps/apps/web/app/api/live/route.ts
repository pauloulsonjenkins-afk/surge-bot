import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { fetchLivePicks } from "@/server/engine-client";

// Node runtime, not Edge: Edge can't reach the app's internal DigitalOcean
// networking (same reason as the picks route).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Same sign-in as the admin area. The alerts are your own paid signals, so
  // they are not served to anyone without a session.
  const token = cookies().get(ADMIN_COOKIE_NAME)?.value;
  if (!(await verifySessionToken(token))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50;

  try {
    const picks = await fetchLivePicks(limit);
    return NextResponse.json({ picks });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
