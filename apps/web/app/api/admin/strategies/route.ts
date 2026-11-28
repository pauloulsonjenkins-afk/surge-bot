import { NextResponse } from "next/server";
import { fetchAdminStrategies, mergeAdminStrategy } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";
import { summariseStrategy } from "@/lib/strategy-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every strategy (admin only). ?view=summary: only what the Strategies overview shows (strategy-summary.ts). */
export async function GET(request: Request) {
  if (!(await isAdmin())) return unauthorized();
  const params = new URL(request.url).searchParams;
  const raw = params.get("since");
  const since = raw && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : null;
  try {
    const data = await fetchAdminStrategies(since);
    if (params.get("view") === "summary") return NextResponse.json({ strategies: data.strategies.map(summariseStrategy) });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}

/** Body: { from: string, into: string | null }. into = null undoes a merge. */
export async function POST(request: Request) {
  if (!(await isAdmin())) return unauthorized();
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
