import { NextResponse } from "next/server";
import { fetchDiscrepancies, reviewResult } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Results the alert's own tick disagrees with, still to review. */
export async function GET() {
  if (!(await isAdmin())) return unauthorized();
  try {
    return NextResponse.json({ picks: await fetchDiscrepancies() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}

/** Body: { id, ok }. Accepts (or un-accepts) a reviewed result. */
export async function POST(request: Request) {
  if (!(await isAdmin())) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; ok?: unknown };
  if (typeof body.id !== "number") return NextResponse.json({ error: "id is required" }, { status: 400 });
  try {
    return NextResponse.json(await reviewResult(body.id, body.ok !== false));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 400 });
  }
}
