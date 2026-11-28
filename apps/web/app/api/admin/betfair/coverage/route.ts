import { NextResponse } from "next/server";
import { checkCoverage, fetchCoverage } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The leagues your alerts came from, checked against the competitions Betfair lists (admin only). */
export async function GET() {
  if (!(await isAdmin())) return unauthorized();
  try {
    return NextResponse.json(await fetchCoverage());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}

/** Body: { names: string[] }. A pasted list, e.g. InPlayGuru's leagues. */
export async function POST(request: Request) {
  if (!(await isAdmin())) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as { names?: unknown; save?: unknown };
  const names = Array.isArray(body.names) ? body.names.filter((n): n is string => typeof n === "string").slice(0, 5000) : [];
  if (names.length === 0) return NextResponse.json({ error: "Paste at least one league." }, { status: 400 });
  try {
    return NextResponse.json(await checkCoverage(names, body.save === true));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
