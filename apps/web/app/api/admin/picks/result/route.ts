import { NextResponse } from "next/server";
import { setPickResult } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return unauthorized();
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
