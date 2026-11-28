import { NextResponse } from "next/server";
import { setPickExcluded } from "@/server/engine-client";
import { isAdmin, unauthorized } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return unauthorized();
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
