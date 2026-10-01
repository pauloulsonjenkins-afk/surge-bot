import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { setPickResult } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = (await request.json()) as { id?: unknown; result?: unknown };
    const id = typeof body.id === "number" && Number.isInteger(body.id) ? body.id : null;
    const result = body.result === "hit" || body.result === "miss" ? body.result : body.result === null ? null : undefined;
    if (id === null || result === undefined) {
      return NextResponse.json({ error: "id and result are required" }, { status: 400 });
    }
    await setPickResult(id, result);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
