import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import { setPickExcluded } from "@/server/engine-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await verifySessionToken(cookies().get(ADMIN_COOKIE_NAME)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = (await request.json()) as { id?: unknown; excluded?: unknown };
    const id = typeof body.id === "number" && Number.isInteger(body.id) ? body.id : null;
    if (id === null || typeof body.excluded !== "boolean") {
      return NextResponse.json({ error: "id and excluded are required" }, { status: 400 });
    }
    await setPickExcluded(id, body.excluded);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown_error" }, { status: 502 });
  }
}
