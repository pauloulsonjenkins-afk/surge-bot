import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { checkCoverage, fetchCoverage } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function isAdmin(): Promise<boolean> {
  return verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value);
}

/** The leagues your alerts came from, checked against the competitions Betfair lists (admin only). */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await fetchCoverage());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}

/** Body: { names: string[] }. A pasted list, e.g. InPlayGuru's leagues. */
export async function POST(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { names?: unknown; save?: unknown };
  const names = Array.isArray(body.names) ? body.names.filter((n): n is string => typeof n === "string").slice(0, 5000) : [];
  if (names.length === 0) return NextResponse.json({ error: "Paste at least one league." }, { status: 400 });
  try {
    return NextResponse.json(await checkCoverage(names, body.save === true));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
