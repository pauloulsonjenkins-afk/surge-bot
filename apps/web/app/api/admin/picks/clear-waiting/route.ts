import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { setPickWaitingCleared } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Body: { id: number, cleared: boolean }. Clears a pick from Live's "Waiting for a result", or puts it back. */
export async function POST(request: Request) {
  if (!(await verifySessionToken((await cookies()).get(ADMIN_COOKIE_NAME)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = (await request.json()) as { id?: unknown; cleared?: unknown };
    const id = typeof body.id === "number" && Number.isInteger(body.id) ? body.id : null;
    if (id === null || typeof body.cleared !== "boolean") {
      return NextResponse.json({ error: "id and cleared are required" }, { status: 400 });
    }
    await setPickWaitingCleared(id, body.cleared);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
