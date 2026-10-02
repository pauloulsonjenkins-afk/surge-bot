import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { fetchAdminStrategies, mergeAdminStrategy } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function isAdmin(): Promise<boolean> {
  return verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value);
}

export async function GET(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const raw = new URL(request.url).searchParams.get("since");
  const since = raw && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : null;
  try {
    return NextResponse.json(await fetchAdminStrategies(since));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}

/** Body: { from: string, into: string | null }. into = null undoes a merge. */
export async function POST(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { from?: unknown; into?: unknown };
  const from = typeof body.from === "string" ? body.from.trim() : "";
  const into = typeof body.into === "string" ? body.into.trim() : null;
  if (!from || (body.into !== null && body.into !== undefined && !into)) {
    return NextResponse.json({ error: "from and into are required" }, { status: 400 });
  }
  try {
    await mergeAdminStrategy(from, into || null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    // The engine's reason is written for the admin ("A strategy can't be merged into itself."), so it is passed on.
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 409 });
  }
}
