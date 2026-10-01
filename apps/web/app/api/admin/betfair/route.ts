import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { fetchReconcile, importBetHistory } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function isAdmin(): Promise<boolean> {
  return verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value);
}

/** Real bets from the betting software against the app's estimates, per strategy. */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await fetchReconcile());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}

/** Body: { csv: string, source?: string, timeZone?: string }. An exported bet history, uploaded on the Reconcile page. */
export async function POST(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { csv?: unknown; source?: unknown; timeZone?: unknown };
  if (typeof body.csv !== "string" || !body.csv.trim()) return NextResponse.json({ error: "The file is empty." }, { status: 400 });
  try {
    const timeZone = typeof body.timeZone === "string" ? body.timeZone.slice(0, 64) : null;
    return NextResponse.json(await importBetHistory(body.csv, typeof body.source === "string" ? body.source.slice(0, 120) : "upload", timeZone));
  } catch (err) {
    // The engine's reason says what the file is missing, so it is passed on.
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 422 });
  }
}
